import { rmSync } from "node:fs";
import path from "node:path";
import type { Common } from "@/Ponder.js";
import type { TableIds } from "@/build/static/ids.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import type { Checkpoint } from "@/utils/checkpoint.js";
import { createSqliteDatabase } from "@/utils/sqlite.js";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, Migrator, SqliteDialect, sql } from "kysely";
import type { DatabaseService } from "../service.js";
import { migrationProvider } from "./migrations.js";

/**
 * database name (file)
 *   table name
 *
 * ponder_core_cache.db
 *   metadata
 *     function_id
 *     from
 *     to
 *     event_count
 *   {table_id}
 *     {...columns}
 *     _from_checkpoint
 *     _to_checkpoint
 *
 * ponder_core_{instance_id}.db
 *   {table_id}
 *     {...columns}
 *     _from_checkpoint
 *     _to_checkpoint
 *
 * ponder_sync.db
 *   blocks
 *   {...sync tables}
 */

export class SqliteDatabaseService implements DatabaseService {
  kind = "sqlite" as const;

  private common: Common;
  private directory: string;

  private sqliteDatabase: BetterSqlite3.Database;

  db: Kysely<any>;
  schema?: Schema;
  tableIds?: TableIds;

  constructor({
    common,
    directory,
  }: {
    common: Common;
    directory: string;
  }) {
    this.common = common;
    this.directory = directory;

    const coldDbPath = path.join(directory, "ponder_core_cache.db");
    const instanceDbPath = path.join(
      directory,
      `ponder_core_${common.instanceId}.db`,
    );

    const sqliteDatabase = createSqliteDatabase(instanceDbPath);
    sqliteDatabase.exec(`ATTACH DATABASE '${coldDbPath}' AS cold`);

    this.sqliteDatabase = sqliteDatabase;

    this.db = new Kysely({
      dialect: new SqliteDialect({ database: sqliteDatabase }),
      log(event) {
        console.log(event);
        // if (event.level === "query")
        //   common.metrics.ponder_sqlite_query_count?.inc({ kind: "indexing" });
      },
    });
  }

  async getMainDatabase() {
    return this.sqliteDatabase;
  }

  async getPluginDatabase(pluginName: string) {
    const dbPath = path.join(this.directory, `ponder_${pluginName}.db`);
    const sqliteDatabase = createSqliteDatabase(dbPath);
    return sqliteDatabase;
  }

  async setup() {
    // Connect
    // Create if not exists the database files / databases
    // Attach cold storage database to instance database
    // 1) Create instance database
    // 2) Create (if not exists) and migrate the cold database
    // 3) Attach cold database to instance database
    // 4) Create user tables in instance database
    // 5) (if found) Copy data from cold to instance database and update in-memory checkpoints

    const coldMigrator = new Migrator({
      db: this.db,
      provider: migrationProvider,
      migrationTableName: "cold.migrations",
      migrationLockTableName: "cold.migrations_lock",
    });
    const result = await coldMigrator.migrateToLatest();
    if (result.error) throw result.error;
  }

  async kill() {
    // Flush

    await this.db.destroy();

    rmSync(
      path.join(this.directory, `ponder_core_${this.common.instanceId}.db`),
    );
  }

  async reset({
    schema,
    tableIds,
  }: { schema?: Schema; tableIds?: TableIds } = {}): Promise<{
    [functionIds: string]: {
      fromCheckpoint: Checkpoint;
      toCheckpoint: Checkpoint;
      eventCount: number;
    };
  }> {
    // If there is no existing schema and no new schema was provided, do nothing.
    if (!this.schema && !schema && !this.tableIds && !tableIds) return {};

    // Set the new schema.
    if (schema) this.schema = schema;
    if (tableIds) this.tableIds = tableIds;

    await this.db.transaction().execute(async (tx) => {
      // Create tables for new schema.
      await Promise.all(
        Object.entries(this.schema!.tables).map(
          async ([tableName, columns]) => {
            const versionedTableName = `${tableName}_versioned`;

            let tableBuilder = tx.schema
              .createTable(versionedTableName)
              .ifNotExists();

            Object.entries(columns).forEach(([columnName, column]) => {
              if (isOneColumn(column)) return;
              if (isManyColumn(column)) return;
              if (isEnumColumn(column)) {
                // Handle enum types
                tableBuilder = tableBuilder.addColumn(
                  columnName,
                  "text",
                  (col) => {
                    if (!column.optional) col = col.notNull();
                    if (!column.list) {
                      col = col.check(
                        sql`${sql.ref(columnName)} in (${sql.join(
                          schema!.enums[column.type].map((v) => sql.lit(v)),
                        )})`,
                      );
                    }
                    return col;
                  },
                );
              } else if (column.list) {
                // Handle scalar list columns
                tableBuilder = tableBuilder.addColumn(
                  columnName,
                  "text",
                  (col) => {
                    if (!column.optional) col = col.notNull();
                    return col;
                  },
                );
              } else {
                // Non-list base columns
                tableBuilder = tableBuilder.addColumn(
                  columnName,
                  scalarToSqlType[column.type],
                  (col) => {
                    if (!column.optional) col = col.notNull();
                    return col;
                  },
                );
              }
            });

            tableBuilder = tableBuilder.addColumn(
              "effectiveFromCheckpoint",
              "varchar(58)",
              (col) => col.notNull(),
            );
            tableBuilder = tableBuilder.addColumn(
              "effectiveToCheckpoint",
              "varchar(58)",
              (col) => col.notNull(),
            );
            tableBuilder = tableBuilder.addPrimaryKeyConstraint(
              `${versionedTableName}_effectiveToCheckpoint_unique`,
              ["id", "effectiveToCheckpoint"] as never[],
            );

            await tableBuilder.execute();
          },
        ),
      );
    });

    // TODO(kyle): check cache, maybe don't create tables, copy tables over, return checkpoints

    return {};
  }

  async flush(
    functionId: string,
    fromCheckpoint: Checkpoint,
    toCheckpoint: Checkpoint,
    eventCount: number,
  ) {
    // In transaction, copy instance database to cold storage and update metadata
    // (accounting for finality)
  }

  async publish() {
    // ???
    // Write schema JSON to metadata location ?
    // publish = async () => {
    //   return this.wrap({ method: "publish" }, async () => {
    //     await this.db.transaction().execute(async (tx) => {
    //       // Create views for the latest version of each table.
    //       await Promise.all(
    //         Object.entries(this.schema!.tables).map(
    //           async ([tableName, columns]) => {
    //             await tx.schema.dropView(tableName).ifExists().execute();
    //             const columnNames = Object.entries(columns)
    //               .filter(([, c]) => !isOneColumn(c) && !isManyColumn(c))
    //               .map(([name]) => name);
    //             await tx.schema
    //               .createView(tableName)
    //               .as(
    //                 tx
    //                   .selectFrom(this.tableIds![tableName])
    //                   .select(columnNames)
    //                   .where("effectiveToCheckpoint", "=", "latest"),
    //               )
    //               .execute();
    //           },
    //         ),
    //       );
    //     });
    //   });
    // };
  }
}

const scalarToSqlType = {
  boolean: "integer",
  int: "integer",
  float: "text",
  string: "text",
  bigint: "varchar(79)",
  hex: "blob",
} as const;
