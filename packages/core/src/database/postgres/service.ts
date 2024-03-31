import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import type { SyncStoreTables } from "@/sync-store/postgres/encoding.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { formatShortDate } from "@/utils/date.js";
import { hash } from "@/utils/hash.js";
import { createPool } from "@/utils/pg.js";
import { startClock } from "@/utils/timer.js";
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
import type { BaseDatabaseService, NamespaceInfo } from "../service.js";
import { type InternalTables, migrationProvider } from "./migrations.js";

const HEARTBEAT_INTERVAL_MS = 1000 * 10; // 10 seconds
const HEARTBEAT_TIMEOUT_MS = 1000 * 60; // 60 seconds

export class PostgresDatabaseService implements BaseDatabaseService {
  kind = "postgres" as const;

  private common: Common;
  private poolConfig: PoolConfig;
  private userNamespace: string;
  private internalNamespace: string;

  db: Kysely<InternalTables>;
  indexingDb: HeadlessKysely<InternalTables>;
  syncDb: HeadlessKysely<SyncStoreTables>;

  private appId: string = null!;
  private heartbeatInterval?: NodeJS.Timeout;

  // Only need these for metrics.
  private adminPool: Pool;
  private indexingPool: Pool;
  private syncPool: Pool;

  constructor({
    common,
    poolConfig,
    userNamespace = "public",
  }: {
    common: Common;
    poolConfig: PoolConfig;
    userNamespace?: string;
  }) {
    this.common = common;
    this.poolConfig = poolConfig;
    this.userNamespace = userNamespace;
    this.internalNamespace = "ponder";

    this.adminPool = createPool({ ...poolConfig, min: 2, max: 2 });
    this.indexingPool = createPool(this.poolConfig);
    this.syncPool = createPool(this.poolConfig);

    this.db = new Kysely<InternalTables>({
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

  async setup({ schema, appId }: { schema: Schema; appId: string }) {
    this.appId = appId;

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
      migrationTableName: "migration",
      migrationLockTableName: "migration_lock",
    });
    const result = await migrator.migrateToLatest();

    if (result.error) throw result.error;

    const namespaceInfo = {
      userNamespace: this.userNamespace,
      internalNamespace: this.internalNamespace,
      internalTableIds: Object.keys(schema.tables).reduce((acc, tableName) => {
        acc[tableName] = hash([this.userNamespace, this.appId, tableName]);
        return acc;
      }, {} as { [tableName: string]: string }),
    } satisfies NamespaceInfo;

    return this.wrap({ method: "setup" }, async () => {
      const checkpoint = await this.db.transaction().execute(async (tx) => {
        const priorLockRow = await tx
          .withSchema(this.internalNamespace)
          .selectFrom("namespace_lock")
          .selectAll()
          .where("namespace", "=", this.userNamespace)
          .executeTakeFirst();

        const newLockRow = {
          namespace: this.userNamespace,
          is_locked: 1,
          heartbeat_at: Date.now(),
          app_id: this.appId,
          checkpoint: encodeCheckpoint(zeroCheckpoint),
          finality_checkpoint: encodeCheckpoint(zeroCheckpoint),
          schema: JSON.stringify(schema),
        } satisfies Insertable<InternalTables["namespace_lock"]>;

        // If no lock row is found for this namespace, we can acquire the lock.
        if (priorLockRow === undefined) {
          await tx
            .withSchema(this.internalNamespace)
            .insertInto("namespace_lock")
            .values(newLockRow)
            .execute();
        }
        // If there is a row, but the lock is not held or has expired,
        // we can acquire the lock and drop the prior app's tables.
        else if (
          priorLockRow.is_locked === 0 ||
          Date.now() > priorLockRow.heartbeat_at + HEARTBEAT_TIMEOUT_MS
        ) {
          // // If the prior row has the same app ID, continue where the prior app left off
          // // by reverting tables to the finality checkpoint, then returning.
          // if (priorLockRow.app_id === this.appId) {
          //   const finalityCheckpoint = decodeCheckpoint(
          //     priorLockRow.finality_checkpoint,
          //   );

          //   const duration =
          //     Math.floor(Date.now() / 1000) - finalityCheckpoint.blockTimestamp;
          //   const progressText =
          //     finalityCheckpoint.blockTimestamp > 0
          //       ? `last used ${formatShortDate(duration)} ago`
          //       : "with no progress";
          //   this.common.logger.debug({
          //     service: "database",
          //     msg: `Cache hit for app ID '${this.appId}' on namespace '${this.userNamespace}' ${progressText}`,
          //   });

          //   // Acquire the lock and update the heartbeat (app_id, schema, ).
          //   await tx
          //     .withSchema(this.internalNamespace)
          //     .updateTable("namespace_lock")
          //     .set({
          //       is_locked: 1,
          //       heartbeat_at: encodeAsText(BigInt(Date.now())),
          //     })
          //     .execute();

          //   // Revert the tables to the finality checkpoint. Note that this also updates
          //   // the namespace_lock table to reflect the new finality checkpoint.
          //   // TODO MOVE THIS BACK await this.revert({ checkpoint: finalityCheckpoint });

          //   return finalityCheckpoint;
          // }

          // If the prior row has a different app ID, drop the prior app's tables.
          const priorAppId = priorLockRow.app_id;
          const priorSchema = priorLockRow.schema as unknown as Schema;

          for (const tableName of Object.keys(priorSchema.tables)) {
            const tableId = hash([this.userNamespace, priorAppId, tableName]);

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
          }

          // Update the lock row to reflect the new app ID and checkpoint progress.
          await tx
            .withSchema(this.internalNamespace)
            .updateTable("namespace_lock")
            .set(newLockRow)
            .execute();
        }
        // Otherwise, the prior app still holds the lock.
        else {
          throw new NonRetryableError(
            `Failed to acquire namespace '${this.userNamespace}' because it is locked by a different app`,
          );
        }

        // Create the operation log tables and user tables.
        for (const [tableName, columns] of Object.entries(schema.tables)) {
          const tableId = namespaceInfo.internalTableIds[tableName];

          await tx.schema
            .withSchema(this.internalNamespace)
            .createTable(tableId)
            .$call((builder) => this.buildOperationLogColumns(builder, columns))
            .addPrimaryKeyConstraint(`${tableId}_pk`, [
              "id",
              "checkpoint",
            ] as any)
            .execute();

          try {
            await tx.schema
              .withSchema(this.userNamespace)
              .createTable(tableName)
              .$call((builder) => this.buildColumns(builder, schema, columns))
              .execute();
          } catch (err) {
            const error = err as Error;
            if (error.message.includes("already exists")) {
              throw new NonRetryableError(
                `Table '${this.userNamespace}'.'${tableName}' already exists. Please drop it and try again.`,
              );
            } else {
              throw error;
            }
          }
        }

        return zeroCheckpoint;
      });

      // Start the heartbeat interval to hold the lock for as long as the process is running.
      this.heartbeatInterval = setInterval(async () => {
        try {
          const lockRow = await this.db
            .withSchema(this.internalNamespace)
            .updateTable("namespace_lock")
            .set({ heartbeat_at: Date.now() })
            .returningAll()
            .executeTakeFirst();

          this.common.logger.debug({
            service: "database",
            msg: `Updated heartbeat timestamp to ${lockRow?.heartbeat_at} (app_id=${this.appId})`,
          });
        } catch (e) {
          console.log(e);
        }
      }, HEARTBEAT_INTERVAL_MS);

      return { checkpoint, namespaceInfo };
    });
  }

  async kill() {
    await this.wrap({ method: "kill" }, async () => {
      clearInterval(this.heartbeatInterval);

      await this.db
        .withSchema(this.internalNamespace)
        .updateTable("namespace_lock")
        .set({ is_locked: 0 })
        .where("namespace", "=", this.userNamespace)
        .returningAll()
        .executeTakeFirst();

      this.common.logger.debug({
        service: "database",
        msg: `Released lock on namespace '${this.userNamespace}'`,
      });

      await this.indexingDb.destroy();
      await this.syncDb.destroy();
      await this.db.destroy();
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
        builder = builder.addColumn(columnName, scalarToSqlType[column.type]);
      }
    });

    builder = builder
      .addColumn("checkpoint", "varchar(58)", (col) => col.notNull())
      .addColumn("operation", "integer", (col) => col.notNull());

    return builder;
  }

  private wrap = async <T>(
    options: { method: string },
    fn: () => Promise<T>,
  ) => {
    const endClock = startClock();
    const RETRY_COUNT = 3;
    const BASE_DURATION = 100;

    let error: any;
    let hasError = false;

    for (let i = 0; i < RETRY_COUNT + 1; i++) {
      try {
        const result = await fn();
        this.common.metrics.ponder_database_method_duration.observe(
          { service: "database", method: options.method },
          endClock(),
        );
        return result;
      } catch (_error) {
        if (_error instanceof NonRetryableError) {
          throw _error;
        }

        if (!hasError) {
          hasError = true;
          error = _error;
        }

        if (i < RETRY_COUNT) {
          const duration = BASE_DURATION * 2 ** i;
          this.common.logger.warn({
            service: "database",
            msg: `Database error while running ${options.method}, retrying after ${duration} milliseconds. Error: ${error.message}`,
          });
          await new Promise((_resolve) => {
            setTimeout(_resolve, duration);
          });
        }
      }
    }

    this.common.metrics.ponder_database_method_error_total.inc({
      service: "database",
      method: options.method,
    });

    throw error;
  };

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
