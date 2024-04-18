import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import type { SyncStoreTables } from "@/sync-store/postgres/encoding.js";
import {
  migrationProvider as syncMigrationProvider,
  moveLegacyTables,
} from "@/sync-store/postgres/migrations.js";
import {
  type Checkpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { formatEta } from "@/utils/format.js";
import { hash } from "@/utils/hash.js";
import { createPool } from "@/utils/pg.js";
import {
  type CreateTableBuilder,
  type Insertable,
  Kysely,
  Migrator,
  PostgresDialect,
  WithSchemaPlugin,
  sql,
} from "kysely";
import type { Pool, PoolConfig } from "pg";
import prometheus from "prom-client";
import { HeadlessKysely } from "../kysely.js";
import { revertIndexingTables } from "../revert.js";
import type { BaseDatabaseService, NamespaceInfo } from "../service.js";
import { type InternalTables, migrationProvider } from "./migrations.js";

const HEARTBEAT_INTERVAL_MS = 1000 * 10; // 10 seconds
const HEARTBEAT_TIMEOUT_MS = 1000 * 60; // 60 seconds

export class PostgresDatabaseService implements BaseDatabaseService {
  kind = "postgres" as const;

  private internalNamespace = "ponder";

  private common: Common;
  private poolConfig: PoolConfig;
  private userNamespace: string;
  private publishSchema?: string | undefined;

  db: HeadlessKysely<InternalTables>;
  indexingDb: HeadlessKysely<any>;
  syncDb: HeadlessKysely<SyncStoreTables>;

  private schema: Schema = null!;
  private buildId: string = null!;
  private heartbeatInterval?: NodeJS.Timeout;

  // Only need these for metrics.
  private adminPool: Pool;
  private indexingPool: Pool;
  private syncPool: Pool;

  constructor({
    common,
    poolConfig,
    userNamespace,
    publishSchema,
  }: {
    common: Common;
    poolConfig: PoolConfig;
    userNamespace: string;
    publishSchema?: string | undefined;
  }) {
    this.common = common;
    this.poolConfig = poolConfig;
    this.userNamespace = userNamespace;
    this.publishSchema = publishSchema;

    this.adminPool = createPool({
      ...poolConfig,
      // 10 minutes to accommodate slow sync store migrations.
      statement_timeout: 10 * 60 * 1000,
    });
    this.indexingPool = createPool(this.poolConfig);
    this.syncPool = createPool(this.poolConfig);

    this.db = new HeadlessKysely<InternalTables>({
      name: "admin",
      common,
      dialect: new PostgresDialect({ pool: this.adminPool }),
      log(event) {
        if (event.level === "query") {
          common.metrics.ponder_postgres_query_total.inc({ pool: "admin" });
        }
      },
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
      internalTableIds: Object.keys(schema.tables).reduce((acc, tableName) => {
        acc[tableName] = hash([this.userNamespace, this.buildId, tableName]);
        return acc;
      }, {} as { [tableName: string]: string }),
    } satisfies NamespaceInfo;

    return this.db.wrap({ method: "setup" }, async () => {
      const checkpoint = await this.db.transaction().execute(async (tx) => {
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
          schema: JSON.stringify(schema),
        } satisfies Insertable<InternalTables["namespace_lock"]>;

        // If no lock row is found for this namespace, we can acquire the lock.
        if (previousLockRow === undefined) {
          await tx
            .withSchema(this.internalNamespace)
            .insertInto("namespace_lock")
            .values(newLockRow)
            .execute();
          this.common.logger.debug({
            service: "database",
            msg: `Acquired lock on new namespace '${this.userNamespace}'`,
          });
        }
        // If there is a row, but the lock is not held or has expired,
        // we can acquire the lock and drop the previous app's tables.
        else if (
          previousLockRow.is_locked === 0 ||
          Date.now() > previousLockRow.heartbeat_at + HEARTBEAT_TIMEOUT_MS
        ) {
          // // If the previous row has the same build ID, continue where the previous app left off
          // // by reverting tables to the finalized checkpoint, then returning.
          // if (previousLockRow.build_id === this.buildId) {
          //   const finalizedCheckpoint = decodeCheckpoint(
          //     previousLockRow.finalized_checkpoint,
          //   );

          //   const duration =
          //     Math.floor(Date.now() / 1000) - finalizedCheckpoint.blockTimestamp;
          //   const progressText =
          //     finalizedCheckpoint.blockTimestamp > 0
          //       ? `last used ${formatShortDate(duration)} ago`
          //       : "with no progress";
          //   this.common.logger.debug({
          //     service: "database",
          //     msg: `Cache hit for build ID '${this.buildId}' on namespace '${this.userNamespace}' ${progressText}`,
          //   });

          //   // Acquire the lock and update the heartbeat (build_id, schema, ).
          //   await tx
          //     .withSchema(this.internalNamespace)
          //     .updateTable("namespace_lock")
          //     .set({
          //       is_locked: 1,
          //       heartbeat_at: encodeAsText(BigInt(Date.now())),
          //     })
          //     .execute();

          //   // Revert the tables to the finalized checkpoint. Note that this also updates
          //   // the namespace_lock table to reflect the new finalized checkpoint.
          //   // TODO MOVE THIS BACK await this.revert({ checkpoint: finalizedCheckpoint });

          //   return finalizedCheckpoint;
          // }

          // If the previous row has a different build ID, drop the previous app's tables.
          const previousBuildId = previousLockRow.build_id;
          const previousSchema = previousLockRow.schema as unknown as Schema;

          this.common.logger.debug({
            service: "database",
            msg: `Acquired lock on namespace '${this.userNamespace}' previously used by app '${previousBuildId}'`,
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
              msg: `Dropped '${tableName}' table left by previous app`,
            });
          }

          // Update the lock row to reflect the new build ID and checkpoint progress.
          await tx
            .withSchema(this.internalNamespace)
            .updateTable("namespace_lock")
            .where("namespace", "=", this.userNamespace)
            .set(newLockRow)
            .execute();
        }
        // Otherwise, the previous app still holds the lock.
        else {
          const expiresIn = formatEta(
            previousLockRow.heartbeat_at + HEARTBEAT_TIMEOUT_MS - Date.now(),
          );
          throw new NonRetryableError(
            `Schema '${this.userNamespace}' is in use by a different Ponder app (lock expires in ${expiresIn})`,
          );
        }

        // Create the operation log tables and user tables.
        for (const [tableName, columns] of Object.entries(schema.tables)) {
          const tableId = namespaceInfo.internalTableIds[tableName];

          await tx.schema
            .withSchema(this.internalNamespace)
            .createTable(tableId)
            .$call((builder) => this.buildOperationLogColumns(builder, columns))
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
              .$call((builder) => this.buildColumns(builder, schema, columns))
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

        return zeroCheckpoint;
      });

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
              HEARTBEAT_INTERVAL_MS,
            )}`,
            error,
          });
        }
      }, HEARTBEAT_INTERVAL_MS);

      return { checkpoint, namespaceInfo };
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

        for (const tableName of Object.keys(this.schema.tables)) {
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

      await this.indexingDb.destroy();
      await this.syncDb.destroy();
      await this.db.destroy();

      await this.indexingPool.end();
      await this.syncPool.end();
      await this.adminPool.end();

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
    columns: Schema["tables"][string],
  ) {
    Object.entries(columns).forEach(([columnName, column]) => {
      if (isOneColumn(column)) return;
      if (isManyColumn(column)) return;
      if (isEnumColumn(column)) {
        // Handle enum types
        builder = builder.addColumn(columnName, "text", (col) => {
          if (!column.optional) col = col.notNull();
          if (!column.list) {
            col = col.check(
              sql`${sql.ref(columnName)} in (${sql.join(
                schema.enums[column.type].map((v) => sql.lit(v)),
              )})`,
            );
          }
          return col;
        });
      } else if (column.list) {
        // Handle scalar list columns
        builder = builder.addColumn(columnName, "text", (col) => {
          if (!column.optional) col = col.notNull();
          return col;
        });
      } else {
        // Non-list base columns
        builder = builder.addColumn(
          columnName,
          scalarToSqlType[column.type],
          (col) => {
            if (!column.optional) col = col.notNull();
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
    columns: Schema["tables"][string],
  ) {
    Object.entries(columns).forEach(([columnName, column]) => {
      if (isOneColumn(column)) return;
      if (isManyColumn(column)) return;
      if (isEnumColumn(column)) {
        // Handle enum types
        // Omit the CHECK constraint because its included in the user table
        builder = builder.addColumn(columnName, "text");
      } else if (column.list) {
        // Handle scalar list columns
        builder = builder.addColumn(columnName, "text");
      } else {
        // Non-list base columns
        builder = builder.addColumn(
          columnName,
          scalarToSqlType[column.type],
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
            { pool: "indexing", kind: "idle" },
            service.indexingPool.idleCount,
          );
          this.set({ pool: "sync", kind: "idle" }, service.syncPool.idleCount);
          this.set(
            { pool: "admin", kind: "idle" },
            service.adminPool.idleCount,
          );
          this.set(
            { pool: "indexing", kind: "total" },
            service.indexingPool.totalCount,
          );
          this.set(
            { pool: "sync", kind: "total" },
            service.syncPool.totalCount,
          );
          this.set(
            { pool: "admin", kind: "total" },
            service.adminPool.totalCount,
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
          this.set({ pool: "indexing" }, service.indexingPool.waitingCount);
          this.set({ pool: "sync" }, service.syncPool.waitingCount);
          this.set({ pool: "admin" }, service.adminPool.waitingCount);
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
