import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import type { SyncStoreTables } from "@/sync-store/sqlite/encoding.js";
import { encodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { formatEta } from "@/utils/format.js";
import { hash } from "@/utils/hash.js";
import { type SqliteDatabase, createSqliteDatabase } from "@/utils/sqlite.js";
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
  private directory: string;

  private userNamespace: string;
  private internalNamespace: string;

  private internalDatabase: SqliteDatabase;
  private syncDatabase: SqliteDatabase;

  db: HeadlessKysely<InternalTables>;
  indexingDb: HeadlessKysely<InternalTables>;
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

    this.db = new HeadlessKysely<InternalTables>({
      name: "admin",
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
          app_id: this.buildId,
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
          // // If the previous row has the same app ID, continue where the previous app left off
          // // by reverting tables to the finalized checkpoint, then returning.
          // if (previousLockRow.app_id === this.buildId) {
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
          //     msg: `Cache hit for app ID '${this.buildId}' on namespace '${this.userNamespace}' ${progressText}`,
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

          //   // Revert the tables to the finalized checkpoint. Note that this also updates
          //   // the namespace_lock table to reflect the new finalized checkpoint.
          //   // TODO MOVE THIS BACK await this.revert({ checkpoint: finalizedCheckpoint });

          //   return finalizedCheckpoint;
          // }

          // If the previous row has a different app ID, drop the previous app's tables.
          const previousBuildId = previousLockRow.app_id;
          const previousSchema = JSON.parse(previousLockRow.schema) as Schema;

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
              .ifExists()
              .execute();

            this.common.logger.debug({
              service: "database",
              msg: `Dropped '${tableName}' table left by previous app`,
            });
          }

          // Update the lock row to reflect the new app ID and checkpoint progress.
          await tx
            .withSchema(this.internalNamespace)
            .updateTable("namespace_lock")
            .set(newLockRow)
            .execute();
        }
        // Otherwise, the previous app still holds the lock.
        else {
          const expiresIn = formatEta(
            previousLockRow.heartbeat_at + HEARTBEAT_TIMEOUT_MS - Date.now(),
          );
          throw new NonRetryableError(
            `Database file '${this.userNamespace}.db' is in use by a different Ponder app (lock expires in ${expiresIn})`,
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

          try {
            await tx.schema
              .withSchema(this.userNamespace)
              .createTable(tableName)
              .$call((builder) => this.buildColumns(builder, schema, columns))
              .execute();
          } catch (err) {
            const error = err as Error;
            if (!error.message.includes("already exists")) throw error;
            throw new Error(
              `Unable to create table '${this.userNamespace}'.'${tableName}' because a table with that name already exists. Hint: Is there another Ponder app using the '${this.userNamespace}.db' database file?`,
            );
          }

          this.common.logger.debug({
            service: "database",
            msg: `Created '${tableName}' table`,
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
            .set({ heartbeat_at: Date.now() })
            .returningAll()
            .executeTakeFirst();

          this.common.logger.debug({
            service: "database",
            msg: `Updated heartbeat timestamp to ${lockRow?.heartbeat_at} (app_id=${this.buildId})`,
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

  async kill() {
    await this.db.wrap({ method: "kill" }, async () => {
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

      this.syncDatabase.close();
      this.internalDatabase.close();

      this.common.logger.debug({
        service: "database",
        msg: "Closed connection to database",
      });
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
