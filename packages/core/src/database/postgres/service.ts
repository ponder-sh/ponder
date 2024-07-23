import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import type { PoolConfig } from "@/config/database.js";
import type { Enum, Schema, Table } from "@/schema/common.js";
import {
  encodeSchema,
  getEnums,
  getTables,
  isEnumColumn,
  isJSONColumn,
  isListColumn,
  isManyColumn,
  isOneColumn,
  isOptionalColumn,
} from "@/schema/utils.js";
import type { SyncStoreTables } from "@/sync-store/postgres/encoding.js";
import {
  moveLegacyTables,
  migrationProvider as syncMigrationProvider,
} from "@/sync-store/postgres/migrations.js";
import {
  type Checkpoint,
  decodeCheckpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { formatEta } from "@/utils/format.js";
import { hash } from "@/utils/hash.js";
import { createPool, createReadonlyPool } from "@/utils/pg.js";
import { wait } from "@/utils/wait.js";
import {
  type CreateTableBuilder,
  type Insertable,
  type Kysely,
  type Transaction as KyselyTransaction,
  Migrator,
  PostgresDialect,
  WithSchemaPlugin,
  sql,
} from "kysely";
import type { Pool } from "pg";
import prometheus from "prom-client";
import { HeadlessKysely } from "../kysely.js";
import { revertIndexingTables } from "../revert.js";
import type { BaseDatabaseService, NamespaceInfo } from "../service.js";
import { type InternalTables, migrationProvider } from "./migrations.js";

export class PostgresDatabaseService implements BaseDatabaseService {
  kind = "postgres" as const;

  private internalNamespace = "ponder";

  private common: Common;
  private userNamespace: string;
  private publishSchema?: string | undefined;

  db: HeadlessKysely<InternalTables>;
  syncDb: HeadlessKysely<SyncStoreTables>;
  indexingDb: HeadlessKysely<any>;
  readonlyDb: HeadlessKysely<any>;

  private schema: Schema = null!;
  private buildId: string = null!;
  private heartbeatInterval?: NodeJS.Timeout;

  // Only need these for metrics.
  private internalPool: Pool;
  private syncPool: Pool;
  private indexingPool: Pool;
  readonlyPool: Pool;

  constructor({
    common,
    poolConfig,
    userNamespace,
    publishSchema,
    isReadonly = false,
  }: {
    common: Common;
    poolConfig: PoolConfig;
    userNamespace: string;
    publishSchema?: string | undefined;
    isReadonly?: boolean;
  }) {
    this.common = common;
    this.userNamespace = userNamespace;
    this.publishSchema = publishSchema;

    const internalMax = 2;
    const equalMax = Math.floor((poolConfig.max - internalMax) / 3);
    const [readonlyMax, indexingMax, syncMax] = isReadonly
      ? [poolConfig.max - internalMax, 0, 0]
      : [equalMax, equalMax, equalMax];

    this.internalPool = createPool({
      ...poolConfig,
      application_name: `${userNamespace}_internal`,
      max: internalMax,
      statement_timeout: 10 * 60 * 1000, // 10 minutes to accommodate slow sync store migrations.
    });
    this.syncPool = createPool({
      ...poolConfig,
      application_name: `${userNamespace}_sync`,
      max: readonlyMax,
    });
    this.indexingPool = createPool({
      ...poolConfig,
      application_name: `${userNamespace}_indexing`,
      max: indexingMax,
    });
    this.readonlyPool = createReadonlyPool({
      ...poolConfig,
      application_name: `${userNamespace}_readonly`,
      max: syncMax,
    });

    this.db = new HeadlessKysely<InternalTables>({
      name: "internal",
      common,
      dialect: new PostgresDialect({ pool: this.internalPool }),
      log(event) {
        if (event.level === "query") {
          common.metrics.ponder_postgres_query_total.inc({ pool: "internal" });
        }
      },
    });

    this.syncDb = new HeadlessKysely<SyncStoreTables>({
      name: "sync",
      common,
      dialect: new PostgresDialect({ pool: this.syncPool }),
      log(event) {
        if (event.level === "query") {
          common.metrics.ponder_postgres_query_total.inc({ pool: "sync" });
        }
      },
      plugins: [new WithSchemaPlugin("ponder_sync")],
    });

    this.indexingDb = new HeadlessKysely<InternalTables>({
      name: "indexing",
      common,
      dialect: new PostgresDialect({ pool: this.indexingPool }),
      log(event) {
        if (event.level === "query") {
          common.metrics.ponder_postgres_query_total.inc({ pool: "indexing" });
        }
      },
    });

    this.readonlyDb = new HeadlessKysely<InternalTables>({
      name: "readonly",
      common,
      dialect: new PostgresDialect({ pool: this.readonlyPool }),
      log(event) {
        if (event.level === "query") {
          common.metrics.ponder_postgres_query_total.inc({ pool: "readonly" });
        }
      },
    });

    this.registerMetrics();
  }

  async setup({ schema, buildId }: { schema: Schema; buildId: string }) {
    this.schema = schema;
    this.buildId = buildId;

    await this.db.schema
      .createSchema(this.userNamespace)
      .ifNotExists()
      .execute();
    await this.db.schema
      .createSchema(this.internalNamespace)
      .ifNotExists()
      .execute();

    const migrator = new Migrator({
      db: this.db.withPlugin(new WithSchemaPlugin(this.internalNamespace)),
      provider: migrationProvider,
      migrationTableSchema: this.internalNamespace,
    });
    const result = await migrator.migrateToLatest();

    if (result.error) throw result.error;

    const namespaceInfo = {
      userNamespace: this.userNamespace,
      internalNamespace: this.internalNamespace,
      internalTableIds: Object.keys(getTables(schema)).reduce(
        (acc, tableName) => {
          acc[tableName] = hash([this.userNamespace, this.buildId, tableName]);
          return acc;
        },
        {} as { [tableName: string]: string },
      ),
    } satisfies NamespaceInfo;

    return this.db.wrap({ method: "setup" }, async () => {
      const attemptSetup = async () => {
        return await this.db.transaction().execute(async (tx) => {
          const previousLockRow = await tx
            .withSchema(this.internalNamespace)
            .selectFrom("namespace_lock")
            .selectAll()
            .where("namespace", "=", this.userNamespace)
            .executeTakeFirst();

          const newLockRow = {
            namespace: this.userNamespace,
            is_locked: 1,
            heartbeat_at: Date.now(),
            build_id: this.buildId,
            finalized_checkpoint: encodeCheckpoint(zeroCheckpoint),
            // Schema is encoded to be backwards compatible with old versions.
            // `schema` should have to properties "tables" and "enums".
            schema: encodeSchema(schema),
          } satisfies Insertable<InternalTables["namespace_lock"]>;

          // Function to create the operation log tables and user tables.
          const createTables = async () => {
            for (const [tableName, table] of Object.entries(
              getTables(schema),
            )) {
              const tableId = namespaceInfo.internalTableIds[tableName]!;

              await tx.schema
                .withSchema(this.internalNamespace)
                .createTable(tableId)
                .$call((builder) =>
                  this.buildOperationLogColumns(builder, table.table),
                )
                .execute();

              await tx.schema
                .withSchema(this.internalNamespace)
                .createIndex(`${tableId}_checkpointIndex`)
                .on(tableId)
                .column("checkpoint")
                .execute();

              try {
                await tx.schema
                  .withSchema(this.userNamespace)
                  .createTable(tableName)
                  .$call((builder) =>
                    this.buildColumns(builder, schema, table.table),
                  )
                  .execute();
              } catch (err) {
                const error = err as Error;
                if (!error.message.includes("already exists")) throw error;
                throw new NonRetryableError(
                  `Unable to create table '${this.userNamespace}'.'${tableName}' because a table with that name already exists. Is there another application using the '${this.userNamespace}' database schema?`,
                );
              }

              this.common.logger.info({
                service: "database",
                msg: `Created table '${this.userNamespace}'.'${tableName}'`,
              });
            }
          };

          // Create ponder_metadata table if it doesn't exist
          await tx.schema
            .withSchema(this.userNamespace)
            .createTable("_ponder_meta")
            .addColumn("key", "text", (col) => col.primaryKey())
            .addColumn("value", "jsonb")
            .ifNotExists()
            .execute();

          // Create or set status to null
          await tx
            .withSchema(this.userNamespace)
            // @ts-expect-error Kysely doesn't have types for user schema
            .insertInto("_ponder_meta")
            // @ts-expect-error Kysely doesn't have types for user schema
            .values({ key: "status", value: null })
            // @ts-expect-error Kysely doesn't have types for user schema
            .onConflict((oc) => oc.column("key").doUpdateSet({ value: null }))
            .execute();

          // If no lock row is found for this namespace, we can acquire the lock.
          if (previousLockRow === undefined) {
            await tx
              .withSchema(this.internalNamespace)
              .insertInto("namespace_lock")
              .values(newLockRow)
              .execute();
            this.common.logger.debug({
              service: "database",
              msg: `Acquired lock on new schema '${this.userNamespace}'`,
            });

            await createTables();

            return { status: "success", checkpoint: zeroCheckpoint } as const;
          }

          // If the lock row is held and has not expired, we cannot proceed.
          const expiresAt =
            previousLockRow.heartbeat_at +
            this.common.options.databaseHeartbeatTimeout;

          if (previousLockRow.is_locked === 1 && Date.now() <= expiresAt) {
            const expiresInMs = expiresAt - Date.now();
            return { status: "locked", expiresInMs } as const;
          }

          // If the lock row has the same build ID as the current app AND
          // has a non-zero finalized checkpoint, we can revert unfinalized
          // rows and continue where it left off.
          if (
            this.common.options.command === "start" &&
            previousLockRow.build_id === this.buildId &&
            previousLockRow.finalized_checkpoint !==
              encodeCheckpoint(zeroCheckpoint)
          ) {
            this.common.logger.info({
              service: "database",
              msg: `Detected cache hit for build '${this.buildId}' in schema '${
                this.userNamespace
              }' last active ${formatEta(Date.now() - previousLockRow.heartbeat_at)} ago`,
            });

            // Remove any indexes, will be recreated once the app
            // becomes healthy.
            for (const [tableName, table] of Object.entries(
              getTables(schema),
            )) {
              if (table.constraints === undefined) continue;

              for (const name of Object.keys(table.constraints)) {
                await tx.schema
                  .withSchema(this.userNamespace)
                  .dropIndex(`${tableName}_${name}`)
                  .ifExists()
                  .execute();

                this.common.logger.info({
                  service: "database",
                  msg: `Dropped index '${tableName}_${name}' in schema '${this.userNamespace}'`,
                });
              }
            }

            await tx
              .withSchema(this.internalNamespace)
              .updateTable("namespace_lock")
              .set({ is_locked: 1, heartbeat_at: Date.now() })
              .execute();
            this.common.logger.debug({
              service: "database",
              msg: `Acquired lock on schema '${this.userNamespace}'`,
            });

            const finalizedCheckpoint = decodeCheckpoint(
              previousLockRow.finalized_checkpoint,
            );

            this.common.logger.info({
              service: "database",
              msg: `Reverting operations prior to finalized checkpoint (timestamp=${finalizedCheckpoint.blockTimestamp} chainId=${finalizedCheckpoint.chainId} block=${finalizedCheckpoint.blockNumber})`,
            });

            // Revert unfinalized data from the existing tables.
            const tx_ = tx as KyselyTransaction<any>;
            for (const [tableName, tableId] of Object.entries(
              namespaceInfo.internalTableIds,
            )) {
              const rows = await tx_
                .withSchema(namespaceInfo.internalNamespace)
                .deleteFrom(tableId)
                .returningAll()
                .where("checkpoint", ">", previousLockRow.finalized_checkpoint)
                .execute();

              const reversed = rows.sort(
                (a, b) => b.operation_id - a.operation_id,
              );

              for (const log of reversed) {
                if (log.operation === 0) {
                  // Create
                  await tx_
                    .withSchema(namespaceInfo.userNamespace)
                    .deleteFrom(tableName)
                    .where("id", "=", log.id)
                    .execute();
                } else if (log.operation === 1) {
                  // Update
                  log.operation_id = undefined;
                  log.checkpoint = undefined;
                  log.operation = undefined;
                  await tx_
                    .withSchema(namespaceInfo.userNamespace)
                    .updateTable(tableName)
                    .set(log)
                    .where("id", "=", log.id)
                    .execute();
                } else {
                  // Delete
                  log.operation_id = undefined;
                  log.checkpoint = undefined;
                  log.operation = undefined;
                  await tx_
                    .withSchema(namespaceInfo.userNamespace)
                    .insertInto(tableName)
                    .values(log)
                    .execute();
                }
              }

              this.common.logger.info({
                service: "database",
                msg: `Reverted ${rows.length} unfinalized operations from existing '${tableName}' table`,
              });
            }

            return {
              status: "success",
              checkpoint: finalizedCheckpoint,
            } as const;
          }

          // Otherwise, the lock row has a different build ID or a zero finalized checkpoint,
          // so we need to drop the previous app's tables and create new ones.
          const previousBuildId = previousLockRow.build_id;
          // Note: `previousSchema` should only be used to get table names or enum names because
          // the types of `Table` and `Enum` have changed between versions.
          const previousSchema = previousLockRow.schema as unknown as {
            tables: { [tableName: string]: Table };
            enums: { [enumName: string]: Enum };
          };

          await tx
            .withSchema(this.internalNamespace)
            .updateTable("namespace_lock")
            .where("namespace", "=", this.userNamespace)
            .set(newLockRow)
            .execute();

          this.common.logger.debug({
            service: "database",
            msg: `Acquired lock on schema '${this.userNamespace}' previously used by build '${previousBuildId}'`,
          });

          for (const tableName of Object.keys(previousSchema.tables)) {
            const tableId = hash([
              this.userNamespace,
              previousBuildId,
              tableName,
            ]);

            await tx.schema
              .withSchema(this.internalNamespace)
              .dropTable(tableId)
              .ifExists()
              .execute();

            await tx.schema
              .withSchema(this.userNamespace)
              .dropTable(tableName)
              .cascade() // Need cascade here to drop dependent published views.
              .ifExists()
              .execute();

            this.common.logger.debug({
              service: "database",
              msg: `Dropped '${tableName}' table left by previous build`,
            });
          }

          await createTables();

          return { status: "success", checkpoint: zeroCheckpoint } as const;
        });
      };

      const result = await attemptSetup();

      let finalizedCheckpoint: Checkpoint;

      if (result.status === "success") {
        finalizedCheckpoint = result.checkpoint;
      } else {
        // If the namespace is locked, attempt one more time after waiting the timeout.
        const { expiresInMs } = result;
        this.common.logger.warn({
          service: "database",
          msg: `Schema '${this.userNamespace}' is locked by a different Ponder app`,
        });
        this.common.logger.warn({
          service: "database",
          msg: `Waiting ${formatEta(expiresInMs)} for lock on schema '${
            this.userNamespace
          }' to expire...`,
        });

        await wait(expiresInMs);

        const resultTwo = await attemptSetup();
        if (resultTwo.status === "locked") {
          throw new NonRetryableError(
            `Failed to acquire lock on schema '${this.userNamespace}'. A different Ponder app is actively using this schema.`,
          );
        }
        finalizedCheckpoint = resultTwo.checkpoint;
      }

      // Start the heartbeat interval to hold the lock for as long as the process is running.
      this.heartbeatInterval = setInterval(async () => {
        try {
          const lockRow = await this.db
            .withSchema(this.internalNamespace)
            .updateTable("namespace_lock")
            .where("namespace", "=", this.userNamespace)
            .set({ heartbeat_at: Date.now() })
            .returningAll()
            .executeTakeFirst();

          this.common.logger.debug({
            service: "database",
            msg: `Updated heartbeat timestamp to ${lockRow?.heartbeat_at} for current build '${this.buildId}'`,
          });
        } catch (err) {
          const error = err as Error;
          this.common.logger.error({
            service: "database",
            msg: `Failed to update heartbeat timestamp, retrying in ${formatEta(
              this.common.options.databaseHeartbeatInterval,
            )}`,
            error,
          });
        }
      }, this.common.options.databaseHeartbeatInterval);

      return { checkpoint: finalizedCheckpoint, namespaceInfo };
    });
  }

  async revert({
    checkpoint,
    namespaceInfo,
  }: {
    checkpoint: Checkpoint;
    namespaceInfo: NamespaceInfo;
  }) {
    await revertIndexingTables({
      db: this.indexingDb,
      checkpoint,
      namespaceInfo,
    });
  }

  async updateFinalizedCheckpoint({
    checkpoint,
  }: { checkpoint: Checkpoint }): Promise<void> {
    await this.db.wrap({ method: "updateFinalizedCheckpoint" }, async () => {
      await this.db
        .withSchema(this.internalNamespace)
        .updateTable("namespace_lock")
        .where("namespace", "=", this.userNamespace)
        .set({ finalized_checkpoint: encodeCheckpoint(checkpoint) })
        .execute();

      this.common.logger.debug({
        service: "database",
        msg: `Updated finalized checkpoint to (timestamp=${checkpoint.blockTimestamp} chainId=${checkpoint.chainId} block=${checkpoint.blockNumber})`,
      });
    });
  }

  async publish() {
    await this.db.wrap({ method: "publish" }, async () => {
      const publishSchema = this.publishSchema;
      if (publishSchema === undefined) {
        this.common.logger.debug({
          service: "database",
          msg: "Not publishing views, publish schema was not defined",
        });
        return;
      }

      await this.db.transaction().execute(async (tx) => {
        // Create the publish schema if it doesn't exist.
        await tx.schema.createSchema(publishSchema).ifNotExists().execute();

        for (const tableName of Object.keys(getTables(this.schema)).concat(
          "_ponder_meta",
        )) {
          // Check if there is an existing relation with the name we're about to publish.
          const result = await tx.executeQuery<{
            table_type: string;
          }>(
            sql`
              SELECT table_type
              FROM information_schema.tables
              WHERE table_schema = '${sql.raw(publishSchema)}'
              AND table_name = '${sql.raw(tableName)}'
            `.compile(tx),
          );

          const isTable = result.rows[0]?.table_type === "BASE TABLE";
          if (isTable) {
            this.common.logger.warn({
              service: "database",
              msg: `Unable to publish view '${publishSchema}'.'${tableName}' because a table with that name already exists`,
            });
            continue;
          }

          const isView = result.rows[0]?.table_type === "VIEW";
          if (isView) {
            await tx.schema
              .withSchema(publishSchema)
              .dropView(tableName)
              .ifExists()
              .cascade()
              .execute();

            this.common.logger.debug({
              service: "database",
              msg: `Dropped existing view '${publishSchema}'.'${tableName}'`,
            });
          }

          await tx.schema
            .withSchema(publishSchema)
            .createView(tableName)
            .as(
              (tx as Kysely<any>)
                .withSchema(this.userNamespace)
                .selectFrom(tableName)
                .selectAll(),
            )
            .execute();

          this.common.logger.info({
            service: "database",
            msg: `Created view '${publishSchema}'.'${tableName}' serving data from '${this.userNamespace}'.'${tableName}'`,
          });
        }
      });
    });
  }

  async createIndexes({ schema }: { schema: Schema }) {
    await Promise.all(
      Object.entries(getTables(schema)).flatMap(([tableName, table]) => {
        if (table.constraints === undefined) return [];

        return Object.entries(table.constraints).map(async ([name, index]) => {
          await this.db.wrap({ method: "createIndexes" }, async () => {
            const indexName = `${tableName}_${name}`;

            const indexColumn = index[" column"];
            const order = index[" order"];
            const nulls = index[" nulls"];

            const columns = Array.isArray(indexColumn)
              ? indexColumn.map((ic) => `"${ic}"`).join(", ")
              : `"${indexColumn}" ${order === "asc" ? "ASC" : order === "desc" ? "DESC" : ""} ${
                  nulls === "first"
                    ? "NULLS FIRST"
                    : nulls === "last"
                      ? "NULLS LAST"
                      : ""
                }`;

            await this.db.executeQuery(
              sql`CREATE INDEX ${sql.ref(indexName)} ON ${sql.table(
                `${this.userNamespace}.${tableName}`,
              )} (${sql.raw(columns)})`.compile(this.db),
            );
          });

          this.common.logger.info({
            service: "database",
            msg: `Created index '${tableName}_${name}' on columns (${
              Array.isArray(index[" column"])
                ? index[" column"].join(", ")
                : index[" column"]
            }) in schema '${this.userNamespace}'`,
          });
        });
      }),
    );
  }

  async kill() {
    await this.db.wrap({ method: "kill" }, async () => {
      clearInterval(this.heartbeatInterval);

      await this.db
        .withSchema(this.internalNamespace)
        .updateTable("namespace_lock")
        .where("namespace", "=", this.userNamespace)
        .set({ is_locked: 0 })
        .returningAll()
        .executeTakeFirst();

      this.common.logger.debug({
        service: "database",
        msg: `Released lock on namespace '${this.userNamespace}'`,
      });

      await this.readonlyDb.destroy();
      await this.indexingDb.destroy();
      await this.syncDb.destroy();
      await this.db.destroy();

      await this.readonlyPool.end();
      await this.indexingPool.end();
      await this.syncPool.end();
      await this.internalPool.end();

      this.common.logger.debug({
        service: "database",
        msg: "Closed database connection pools",
      });
    });
  }

  async migrateSyncStore() {
    await this.db.wrap({ method: "migrateSyncStore" }, async () => {
      // TODO: Probably remove this at 1.0 to speed up startup time.
      await moveLegacyTables({
        common: this.common,
        db: this.db as Kysely<any>,
        newSchemaName: "ponder_sync",
      });

      const migrator = new Migrator({
        db: this.db.withPlugin(new WithSchemaPlugin("ponder_sync")),
        provider: syncMigrationProvider,
        migrationTableSchema: "ponder_sync",
      });

      const { error } = await migrator.migrateToLatest();
      if (error) throw error;
    });
  }

  private buildColumns<T extends string, C extends string = never>(
    builder: CreateTableBuilder<T, C>,
    schema: Schema,
    table: Table,
  ) {
    Object.entries(table).forEach(([columnName, column]) => {
      if (isOneColumn(column)) return;
      if (isManyColumn(column)) return;
      if (isEnumColumn(column)) {
        // Handle enum types
        builder = builder.addColumn(columnName, "text", (col) => {
          if (isOptionalColumn(column) === false) col = col.notNull();
          if (isListColumn(column) === false) {
            col = col.check(
              sql`${sql.ref(columnName)} in (${sql.join(
                getEnums(schema)[column[" enum"]]!.map((v) => sql.lit(v)),
              )})`,
            );
          }
          return col;
        });
      } else if (isListColumn(column)) {
        // Handle scalar list table
        builder = builder.addColumn(columnName, "text", (col) => {
          if (isOptionalColumn(column) === false) col = col.notNull();
          return col;
        });
      } else if (isJSONColumn(column)) {
        // Handle json columns
        builder = builder.addColumn(columnName, "jsonb", (col) => {
          if (isOptionalColumn(column) === false) col = col.notNull();
          return col;
        });
      } else {
        // Non-list base columns
        builder = builder.addColumn(
          columnName,
          scalarToSqlType[column[" scalar"]],
          (col) => {
            if (isOptionalColumn(column) === false) col = col.notNull();
            if (columnName === "id") col = col.primaryKey();
            return col;
          },
        );
      }
    });

    return builder;
  }

  private buildOperationLogColumns<T extends string, C extends string = never>(
    builder: CreateTableBuilder<T, C>,
    table: Table,
  ) {
    Object.entries(table).forEach(([columnName, column]) => {
      if (isOneColumn(column)) return;
      if (isManyColumn(column)) return;
      if (isEnumColumn(column)) {
        // Handle enum types
        // Omit the CHECK constraint because its included in the user table
        builder = builder.addColumn(columnName, "text");
      } else if (isListColumn(column)) {
        // Handle scalar list columns
        builder = builder.addColumn(columnName, "text");
      } else if (isJSONColumn(column)) {
        // Handle json columns
        builder = builder.addColumn(columnName, "jsonb");
      } else {
        // Non-list base columns
        builder = builder.addColumn(
          columnName,
          scalarToSqlType[column[" scalar"]],
          (col) => {
            if (columnName === "id") col = col.notNull();
            return col;
          },
        );
      }
    });

    builder = builder
      .addColumn("operation_id", "serial", (col) => col.notNull().primaryKey())
      .addColumn("checkpoint", "varchar(75)", (col) => col.notNull())
      .addColumn("operation", "integer", (col) => col.notNull());

    return builder;
  }

  private registerMetrics() {
    const service = this;

    this.common.metrics.registry.removeSingleMetric(
      "ponder_postgres_query_total",
    );
    this.common.metrics.ponder_postgres_query_total = new prometheus.Counter({
      name: "ponder_postgres_query_total",
      help: "Total number of queries submitted to the database",
      labelNames: ["pool"] as const,
      registers: [this.common.metrics.registry],
    });

    this.common.metrics.registry.removeSingleMetric(
      "ponder_postgres_pool_connections",
    );
    this.common.metrics.ponder_postgres_pool_connections = new prometheus.Gauge(
      {
        name: "ponder_postgres_pool_connections",
        help: "Number of connections in the pool",
        labelNames: ["pool", "kind"] as const,
        registers: [this.common.metrics.registry],
        collect() {
          this.set(
            { pool: "internal", kind: "idle" },
            service.internalPool.idleCount,
          );
          this.set(
            { pool: "internal", kind: "total" },
            service.internalPool.totalCount,
          );

          this.set({ pool: "sync", kind: "idle" }, service.syncPool.idleCount);
          this.set(
            { pool: "sync", kind: "total" },
            service.syncPool.totalCount,
          );

          this.set(
            { pool: "indexing", kind: "idle" },
            service.indexingPool.idleCount,
          );
          this.set(
            { pool: "indexing", kind: "total" },
            service.indexingPool.totalCount,
          );

          this.set(
            { pool: "readonly", kind: "idle" },
            service.readonlyPool.idleCount,
          );
          this.set(
            { pool: "readonly", kind: "total" },
            service.readonlyPool.totalCount,
          );
        },
      },
    );

    this.common.metrics.registry.removeSingleMetric(
      "ponder_postgres_query_queue_size",
    );
    this.common.metrics.ponder_postgres_query_queue_size = new prometheus.Gauge(
      {
        name: "ponder_postgres_query_queue_size",
        help: "Number of query requests waiting for an available connection",
        labelNames: ["pool"] as const,
        registers: [this.common.metrics.registry],
        collect() {
          this.set({ pool: "internal" }, service.internalPool.waitingCount);
          this.set({ pool: "sync" }, service.syncPool.waitingCount);
          this.set({ pool: "indexing" }, service.indexingPool.waitingCount);
          this.set({ pool: "readonly" }, service.readonlyPool.waitingCount);
        },
      },
    );
  }
}

const scalarToSqlType = {
  boolean: "integer",
  int: "integer",
  float: "float8",
  string: "text",
  bigint: "numeric(78, 0)",
  hex: "bytea",
} as const;
