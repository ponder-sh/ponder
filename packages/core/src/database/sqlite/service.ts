import fs from "node:fs";
import path from "node:path";
import type { Common } from "@/Ponder.js";
import type { FunctionIds, TableIds } from "@/build/static/ids.js";
import type { TableAccess } from "@/build/static/parseAst.js";
import { revertTable } from "@/indexing-store/utils/revert.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import {
  checkpointMin,
  decodeCheckpoint,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import { dedupe } from "@/utils/dedupe.js";
import { createSqliteDatabase } from "@/utils/sqlite.js";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, Migrator, SqliteDialect, Transaction, sql } from "kysely";
import type { DatabaseService, Metadata } from "../service.js";
import { migrationProvider } from "./migrations.js";

export class SqliteDatabaseService implements DatabaseService {
  kind = "sqlite" as const;

  private common: Common;

  db: Kysely<any>;

  schema?: Schema;
  tableIds?: TableIds;

  metadata: Metadata[] = undefined!;

  private directory: string;

  private sqliteIndexingDatabase: BetterSqlite3.Database;

  constructor({
    common,
    directory,
  }: {
    common: Common;
    directory: string;
  }) {
    this.common = common;
    this.directory = directory;

    const cacheDbPath = path.join(directory, "ponder_core_cache.db");
    const liveDbPath = path.join(
      directory,
      `ponder_core_${common.instanceId}.db`,
    );

    const sqliteDatabase = createSqliteDatabase(liveDbPath);
    sqliteDatabase.exec(`ATTACH DATABASE '${cacheDbPath}' AS cache`);

    this.sqliteIndexingDatabase = sqliteDatabase;

    this.db = new Kysely({
      dialect: new SqliteDialect({ database: sqliteDatabase }),
      log(event) {
        if (event.level === "query") {
          common.metrics.ponder_sqlite_query_count?.inc({ kind: "indexing" });
        }
      },
    });
  }

  async setup() {
    const cacheMigrator = new Migrator({
      db: this.db,
      provider: migrationProvider,
      migrationTableName: "cache.migrations",
      migrationLockTableName: "cache.migrations_lock",
    });
    const result = await cacheMigrator.migrateToLatest();
    if (result.error) throw result.error;
  }

  async getIndexingDatabase(): Promise<{ database: BetterSqlite3.Database }> {
    return { database: this.sqliteIndexingDatabase };
  }

  async getSyncDatabase(): Promise<{ database: BetterSqlite3.Database }> {
    const dbPath = path.join(this.directory, "ponder_sync.db");
    const syncDatabase = createSqliteDatabase(dbPath);
    return { database: syncDatabase };
  }

  async kill() {
    try {
      await this.db.destroy();
    } finally {
      fs.rmSync(
        path.join(this.directory, `ponder_core_${this.common.instanceId}.db`),
      );
    }
  }

  async reset({
    schema,
    tableIds,
    functionIds,
    tableAccess,
  }: {
    schema: Schema;
    tableIds: TableIds;
    functionIds: FunctionIds;
    tableAccess: TableAccess;
  }) {
    if (schema) this.schema = schema;
    if (tableIds) this.tableIds = tableIds;

    const _functionIds = Object.values(functionIds);

    const metadata = await this.db.transaction().execute(async (tx) => {
      await this.createTables(tx, "cache");
      await this.createTables(tx, "live");
      await this.copyTables(tx, "cache");
      return tx
        .withSchema("cache")
        .selectFrom("metadata")
        .selectAll()
        .where("functionId", "in", _functionIds)
        .execute();
    });

    this.metadata = metadata.map((m) => ({
      functionId: m.functionId,
      fromCheckpoint: decodeCheckpoint(m.fromCheckpoint),
      toCheckpoint: decodeCheckpoint(m.toCheckpoint),
      eventCount: m.eventCount,
    }));

    for (const tableName of Object.keys(schema.tables)) {
      const indexingFunctionKeys = tableAccess
        .filter((t) => t.access === "write" && t.table === tableName)
        .map((t) => t.indexingFunctionKey);

      const tableMetadata = dedupe(indexingFunctionKeys).map((key) =>
        this.metadata.find((m) => m.functionId === functionIds[key]),
      );

      if (tableMetadata.some((m) => m === undefined)) return;

      const checkpoints = tableMetadata.map((m) => m!.toCheckpoint);

      const tableCheckpoint = checkpointMin(...checkpoints);

      await revertTable(this.db, tableName, tableCheckpoint);
    }
  }

  async flush(metadata: Metadata[]): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      await this.dropCacheTables(tx);
      await this.createTables(tx, "cache");
      await this.copyTables(tx, "live");

      const values = metadata.map((m) => ({
        functionId: m.functionId,
        fromCheckpoint: m.fromCheckpoint
          ? encodeCheckpoint(m.fromCheckpoint)
          : null,
        toCheckpoint: encodeCheckpoint(m.toCheckpoint),
        eventCount: m.eventCount,
      }));

      for (const row of values) {
        await tx
          .withSchema("cache")
          .insertInto("metadata")
          .values(row)
          .onConflict((oc) => oc.column("functionId").doUpdateSet(row))
          .execute();
      }
    });
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

  private dropCacheTables = (tx: Transaction<any>) =>
    Promise.all(
      Object.keys(this.schema!.tables).map((tableName) =>
        tx
          .withSchema("cache")
          .schema.dropTable(this.tableIds![tableName])
          .ifExists()
          .execute(),
      ),
    );

  private createTables = (_tx: Transaction<any>, database: "cache" | "live") =>
    Promise.all(
      Object.entries(this.schema!.tables).map(async ([tableName, columns]) => {
        // Database specific variables
        const versionedTableName =
          database === "cache"
            ? this.tableIds![tableName]
            : `${tableName}_versioned`;
        const tx = database === "cache" ? _tx.withSchema("cache") : _tx;

        let tableBuilder = tx.schema
          .createTable(versionedTableName)
          .ifNotExists();

        Object.entries(columns).forEach(([columnName, column]) => {
          if (isOneColumn(column)) return;
          if (isManyColumn(column)) return;
          if (isEnumColumn(column)) {
            // Handle enum types
            tableBuilder = tableBuilder.addColumn(columnName, "text", (col) => {
              if (!column.optional) col = col.notNull();
              if (!column.list) {
                col = col.check(
                  sql`${sql.ref(columnName)} in (${sql.join(
                    this.schema!.enums[column.type].map((v) => sql.lit(v)),
                  )})`,
                );
              }
              return col;
            });
          } else if (column.list) {
            // Handle scalar list columns
            tableBuilder = tableBuilder.addColumn(columnName, "text", (col) => {
              if (!column.optional) col = col.notNull();
              return col;
            });
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
      }),
    );

  private copyTables = (tx: Transaction<any>, fromDatabase: "cache" | "live") =>
    Promise.all(
      Object.keys(this.schema!.tables).map(async (tableName) => {
        // Database specific variables
        const fromTable =
          fromDatabase === "cache"
            ? `"cache"."${this.tableIds![tableName]}"`
            : `"${tableName}_versioned"`;
        const toTable =
          fromDatabase === "cache"
            ? `"${tableName}_versioned"`
            : `"cache"."${this.tableIds![tableName]}"`;

        const query = sql`INSERT INTO ${sql.raw(
          toTable,
        )} SELECT * FROM ${sql.raw(fromTable)}`;

        await query.execute(tx);
      }),
    );
}

const scalarToSqlType = {
  boolean: "integer",
  int: "integer",
  float: "text",
  string: "text",
  bigint: "varchar(79)",
  hex: "blob",
} as const;
