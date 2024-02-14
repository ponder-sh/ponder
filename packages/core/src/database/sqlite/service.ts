import fs from "node:fs";
import path from "node:path";
import type { Common } from "@/Ponder.js";
import type { FunctionIds, TableIds } from "@/build/static/ids.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import { decodeCheckpoint, encodeCheckpoint } from "@/utils/checkpoint.js";
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
  private sqliteDatabase: BetterSqlite3.Database;

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
        if (event.level === "query") {
          common.metrics.ponder_sqlite_query_count?.inc({ kind: "indexing" });
        }
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
  }: {
    schema: Schema;
    tableIds: TableIds;
    functionIds: FunctionIds;
  }) {
    if (schema) this.schema = schema;
    if (tableIds) this.tableIds = tableIds;

    const _functionIds = Object.values(functionIds);

    const metadata = await this.db.transaction().execute(async (tx) => {
      await this.createTables(tx, "cold");
      await this.createTables(tx, "hot");
      await this.copyTables(tx, "cold");
      return tx
        .withSchema("cold")
        .selectFrom("metadata")
        .selectAll()
        .where("functionId", "in", _functionIds)
        .execute();
    });

    // TODO: revert tables to toCheckpoint

    this.metadata = metadata.map((m) => ({
      functionId: m.functionId,
      fromCheckpoint: decodeCheckpoint(m.fromCheckpoint),
      toCheckpoint: decodeCheckpoint(m.toCheckpoint),
      eventCount: m.eventCount,
    }));
  }

  async flush(metadata: Metadata[]): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      await this.dropColdTables(tx);
      await this.createTables(tx, "cold");
      await this.copyTables(tx, "hot");

      const values = metadata.map((m) => ({
        functionId: m.functionId,
        fromCheckpoint: encodeCheckpoint(m.fromCheckpoint),
        toCheckpoint: encodeCheckpoint(m.toCheckpoint),
        eventCount: m.eventCount,
      }));

      await Promise.all(
        values.map((row) =>
          tx
            .withSchema("cold")
            .insertInto("metadata")
            .values(row)
            .onConflict((oc) => oc.doUpdateSet(row))
            .execute(),
        ),
      );
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

  private dropColdTables = (tx: Transaction<any>) =>
    Promise.all(
      Object.keys(this.schema!.tables).map((tableName) =>
        tx
          .withSchema("cold")
          .schema.dropTable(this.tableIds![tableName])
          .ifExists()
          .execute(),
      ),
    );

  private createTables = (_tx: Transaction<any>, database: "cold" | "hot") =>
    Promise.all(
      Object.entries(this.schema!.tables).map(async ([tableName, columns]) => {
        // Database specific variables
        const versionedTableName =
          database === "cold"
            ? this.tableIds![tableName]
            : `${tableName}_versioned`;
        const tx = database === "cold" ? _tx.withSchema("cold") : _tx;

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

  private copyTables = (tx: Transaction<any>, fromDatabase: "cold" | "hot") =>
    Promise.all(
      Object.keys(this.schema!.tables).map(async (tableName) => {
        // Database specific variables
        const fromTable =
          fromDatabase === "cold"
            ? `"cold"."${this.tableIds![tableName]}"`
            : `"${tableName}_versioned"`;
        const toTable =
          fromDatabase === "cold"
            ? `"${tableName}_versioned"`
            : `"cold"."${this.tableIds![tableName]}"`;

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
