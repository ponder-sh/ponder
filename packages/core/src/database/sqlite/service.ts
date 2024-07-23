import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
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
import type { SyncStoreTables } from "@/sync-store/sqlite/encoding.js";
import { migrationProvider as syncMigrationProvider } from "@/sync-store/sqlite/migrations.js";
import {
  type Checkpoint,
  decodeCheckpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { formatEta } from "@/utils/format.js";
import { hash } from "@/utils/hash.js";
import {
  type SqliteDatabase,
  createReadonlySqliteDatabase,
  createSqliteDatabase,
} from "@/utils/sqlite.js";
import { wait } from "@/utils/wait.js";
import {
  type CreateTableBuilder,
  type Insertable,
  type Kysely,
  type Transaction as KyselyTransaction,
  Migrator,
  SqliteDialect,
  WithSchemaPlugin,
  sql,
} from "kysely";
import prometheus from "prom-client";
import { HeadlessKysely } from "../kysely.js";
import { revertIndexingTables } from "../revert.js";
import type { BaseDatabaseService, NamespaceInfo } from "../service.js";
import { type InternalTables, migrationProvider } from "./migrations.js";

export class SqliteDatabaseService implements BaseDatabaseService {
  kind = "sqlite" as const;

  private common: Common;
  private directory: string;

  private userNamespace: string;
  private internalNamespace: string;

  private internalDatabase: SqliteDatabase;
  private syncDatabase: SqliteDatabase;
  readonlyDatabase: SqliteDatabase;

  db: HeadlessKysely<InternalTables>;
  readonlyDb: HeadlessKysely<any>;
  indexingDb: HeadlessKysely<any>;
  syncDb: HeadlessKysely<SyncStoreTables>;

  private buildId: string = null!;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor({
    common,
    directory,
    userNamespace = "public",
  }: {
    common: Common;
    directory: string;
    userNamespace?: string;
  }) {
    this.common = common;
    this.directory = directory;

    this.deleteV3DatabaseFiles();

    this.userNamespace = userNamespace;
    const userDatabaseFile = path.join(directory, `${userNamespace}.db`);

    // Note that SQLite supports using "main" as the schema name for tables
    // in the primary database (as opposed to attached databases). We include
    // it here to more closely match Postgres, where it's required.
    // https://www.sqlite.org/lang_attach.html
    this.internalNamespace = "main";
    const internalDatabaseFile = path.join(directory, "ponder.db");

    this.internalDatabase = createSqliteDatabase(internalDatabaseFile);
    this.internalDatabase.exec(
      `ATTACH DATABASE '${userDatabaseFile}' AS ${this.userNamespace}`,
    );

    this.readonlyDatabase = createReadonlySqliteDatabase(internalDatabaseFile);
    this.readonlyDatabase.exec(
      `ATTACH DATABASE '${userDatabaseFile}' AS ${this.userNamespace}`,
    );

    this.db = new HeadlessKysely<InternalTables>({
      name: "internal",
      common,
      dialect: new SqliteDialect({ database: this.internalDatabase }),
      log(event) {
        if (event.level === "query") {
          common.metrics.ponder_sqlite_query_total.inc({
            database: "internal",
          });
        }
      },
    });

    const syncDatabaseFile = path.join(directory, "ponder_sync.db");
    this.syncDatabase = createSqliteDatabase(syncDatabaseFile);
    this.syncDb = new HeadlessKysely<SyncStoreTables>({
      name: "sync",
      common,
      dialect: new SqliteDialect({ database: this.syncDatabase }),
      log(event) {
        if (event.level === "query") {
          common.metrics.ponder_sqlite_query_total.inc({ database: "sync" });
        }
      },
    });

    this.indexingDb = new HeadlessKysely<InternalTables>({
      name: "indexing",
      common,
      dialect: new SqliteDialect({ database: this.internalDatabase }),
      log(event) {
        if (event.level === "query") {
          common.metrics.ponder_sqlite_query_total.inc({
            database: "indexing",
          });
        }
      },
    });

    this.readonlyDb = new HeadlessKysely<InternalTables>({
      name: "readonly",
      common,
      dialect: new SqliteDialect({ database: this.readonlyDatabase }),
      log(event) {
        if (event.level === "query") {
          common.metrics.ponder_sqlite_query_total.inc({
            database: "readonly",
          });
        }
      },
    });

    this.registerMetrics();
  }

  async setup({ schema, buildId }: { schema: Schema; buildId: string }) {
    this.buildId = buildId;

    const migrator = new Migrator({
      db: this.db.withPlugin(new WithSchemaPlugin(this.internalNamespace)),
      provider: migrationProvider,
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
                  `Unable to create table '${tableName}' in '${this.userNamespace}.db' because a table with that name already exists. Is there another application using the '${this.userNamespace}.db' database file?`,
                );
              }

              this.common.logger.info({
                service: "database",
                msg: `Created table '${tableName}' in '${this.userNamespace}.db'`,
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
              msg: `Acquired lock on database file '${this.userNamespace}.db'`,
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
              msg: `Detected cache hit for build '${this.buildId}' in database file '${
                this.userNamespace
              }.db' last active ${formatEta(Date.now() - previousLockRow.heartbeat_at)} ago`,
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
          const previousSchema = JSON.parse(previousLockRow.schema) as {
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
          msg: `Database file '${this.userNamespace}.db' is locked by a different Ponder app`,
        });
        this.common.logger.warn({
          service: "database",
          msg: `Waiting ${formatEta(expiresInMs)} for lock on database file '${
            this.userNamespace
          }.db' to expire...`,
        });

        await wait(expiresInMs);

        const resultTwo = await attemptSetup();
        if (resultTwo.status === "locked") {
          throw new NonRetryableError(
            `Failed to acquire lock on database file '${this.userNamespace}.db'. A different Ponder app is actively using this database.`,
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
            msg: `Updated heartbeat timestamp to ${lockRow?.heartbeat_at} (build_id=${this.buildId})`,
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

  async createIndexes({ schema }: { schema: Schema }) {
    await Promise.all(
      Object.entries(getTables(schema)).flatMap(([tableName, table]) => {
        if (table.constraints === undefined) return [];

        return Object.entries(table.constraints).map(async ([name, index]) => {
          await this.db.wrap({ method: "createIndexes" }, async () => {
            const indexName = `${tableName}_${name}`;

            const indexColumn = index[" column"];
            const order = index[" order"];

            const columns = Array.isArray(indexColumn)
              ? indexColumn.map((ic) => `"${ic}"`).join(", ")
              : `"${indexColumn}" ${order === "asc" ? "ASC" : order === "desc" ? "DESC" : ""}`;

            await this.db.executeQuery(
              sql`CREATE INDEX ${sql.ref(this.userNamespace)}.${sql.ref(indexName)} ON ${sql.table(
                tableName,
              )} (${sql.raw(columns)})`.compile(this.db),
            );
          });

          this.common.logger.info({
            service: "database",
            msg: `Created index '${tableName}_${name}' on columns (${
              Array.isArray(index[" column"])
                ? index[" column"].join(", ")
                : index[" column"]
            }) in '${this.userNamespace}.db'`,
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

      this.syncDatabase.close();
      this.readonlyDatabase.close();
      this.internalDatabase.close();

      this.common.logger.debug({
        service: "database",
        msg: "Closed connection to database",
      });
    });
  }

  async migrateSyncStore() {
    await this.db.wrap({ method: "migrateSyncStore" }, async () => {
      const migrator = new Migrator({
        db: this.syncDb as Kysely<any>,
        provider: syncMigrationProvider,
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
        // Handle scalar list columns
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
      .addColumn("operation_id", "integer", (col) => col.notNull().primaryKey())
      .addColumn("checkpoint", "varchar(75)", (col) => col.notNull())
      .addColumn("operation", "integer", (col) => col.notNull());

    return builder;
  }

  private registerMetrics() {
    this.common.metrics.registry.removeSingleMetric(
      "ponder_sqlite_query_total",
    );
    this.common.metrics.ponder_sqlite_query_total = new prometheus.Counter({
      name: "ponder_sqlite_query_total",
      help: "Number of queries submitted to the database",
      labelNames: ["database"] as const,
      registers: [this.common.metrics.registry],
    });
  }

  private async deleteV3DatabaseFiles() {
    // Detect if the `.ponder/sqlite` directly contains 0.3 database files.
    const hasV3Files = existsSync(path.join(this.directory, "ponder_cache.db"));

    if (!hasV3Files) return;

    this.common.logger.debug({
      service: "database",
      msg: "Migrating '.ponder/sqlite' database from 0.3.x to 0.4.x",
    });

    // Drop 'ponder_cache' database files.
    rmSync(path.join(this.directory, "ponder_cache.db"), { force: true });
    rmSync(path.join(this.directory, "ponder_cache.db-shm"), { force: true });
    rmSync(path.join(this.directory, "ponder_cache.db-wal"), { force: true });
    this.common.logger.debug({
      service: "database",
      msg: `Removed '.ponder/sqlite/ponder_cache.db' file`,
    });

    // Drop 'ponder' database files (they will be created again).
    rmSync(path.join(this.directory, "ponder.db"), { force: true });
    rmSync(path.join(this.directory, "ponder.db-shm"), { force: true });
    rmSync(path.join(this.directory, "ponder.db-wal"), { force: true });
    this.common.logger.debug({
      service: "database",
      msg: `Removed '.ponder/sqlite/ponder.db' file`,
    });
  }
}

const scalarToSqlType = {
  boolean: "integer",
  int: "integer",
  float: "real",
  string: "text",
  bigint: "varchar(79)",
  hex: "blob",
} as const;
