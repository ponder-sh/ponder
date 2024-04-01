import path from "node:path";
import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import type { SyncStoreTables } from "@/sync-store/sqlite/encoding.js";
import { encodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { hash } from "@/utils/hash.js";
import { createSqliteDatabase } from "@/utils/sqlite.js";
import { startClock } from "@/utils/timer.js";
import {
  type CreateTableBuilder,
  type Insertable,
  Migrator,
  SqliteDialect,
  WithSchemaPlugin,
  sql,
} from "kysely";
import prometheus from "prom-client";
import { HeadlessKysely } from "../kysely.js";
import type { BaseDatabaseService, NamespaceInfo } from "../service.js";
import { type InternalTables, migrationProvider } from "./migrations.js";

const HEARTBEAT_INTERVAL_MS = 1000 * 10; // 10 seconds
const HEARTBEAT_TIMEOUT_MS = 1000 * 60; // 60 seconds

export class SqliteDatabaseService implements BaseDatabaseService {
  kind = "sqlite" as const;

  private common: Common;
  private userNamespace: string;
  private internalNamespace: string;

  db: HeadlessKysely<InternalTables>;
  indexingDb: HeadlessKysely<InternalTables>;
  syncDb: HeadlessKysely<SyncStoreTables>;

  private appId: string = null!;
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

    this.userNamespace = userNamespace;
    const userDatabaseFile = path.join(directory, `${userNamespace}.db`);

    // Note that SQLite supports using "main" as the schema name for tables
    // in the primary database (as opposed to attached databases). We include
    // it here to more closely match Postgres, where it's required.
    // https://www.sqlite.org/lang_attach.html
    this.internalNamespace = "main";
    const internalDatabaseFile = path.join(directory, "ponder.db");

    const internalDatabase = createSqliteDatabase(internalDatabaseFile);
    internalDatabase.exec(
      `ATTACH DATABASE '${userDatabaseFile}' AS ${this.userNamespace}`,
    );

    this.db = new HeadlessKysely<InternalTables>({
      name: "admin",
      common,
      dialect: new SqliteDialect({ database: internalDatabase }),
      log(event) {
        if (event.level === "query") {
          common.metrics.ponder_sqlite_query_total.inc({ database: "admin" });
        }
      },
    });

    this.indexingDb = new HeadlessKysely<InternalTables>({
      name: "indexing",
      common,
      dialect: new SqliteDialect({ database: internalDatabase }),
      log(event) {
        if (event.level === "query") {
          common.metrics.ponder_sqlite_query_total.inc({
            database: "indexing",
          });
        }
      },
    });

    const syncDatabaseFile = path.join(directory, "ponder_sync.db");
    const syncDatabase = createSqliteDatabase(syncDatabaseFile);
    this.syncDb = new HeadlessKysely<SyncStoreTables>({
      name: "sync",
      common,
      dialect: new SqliteDialect({ database: syncDatabase }),
      log(event) {
        if (event.level === "query") {
          common.metrics.ponder_sqlite_query_total.inc({ database: "sync" });
        }
      },
    });

    this.registerMetrics();
  }

  async setup({ schema, appId }: { schema: Schema; appId: string }) {
    this.appId = appId;

    const migrator = new Migrator({
      db: this.db.withPlugin(new WithSchemaPlugin(this.internalNamespace)),
      provider: migrationProvider,
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
          const priorSchema = JSON.parse(priorLockRow.schema) as Schema;

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
            .execute();

          await tx.schema
            .withSchema(this.userNamespace)
            .createTable(tableName)
            .$call((builder) => this.buildColumns(builder, schema, columns))
            .execute();
        }

        return zeroCheckpoint;
      });

      // Start the heartbeat interval to hold the lock for as long as the process is running.
      this.heartbeatInterval = setInterval(async () => {
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
      .addColumn("operation_id", "integer", (col) => col.notNull().primaryKey())
      .addColumn("checkpoint", "varchar(75)", (col) => col.notNull())
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
}

const scalarToSqlType = {
  boolean: "integer",
  int: "integer",
  float: "real",
  string: "text",
  bigint: "varchar(79)",
  hex: "blob",
} as const;
