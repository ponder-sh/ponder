import type { Common } from "@/Ponder.js";
import type { FunctionIds, TableIds } from "@/build/static/ids.js";
import type { TableAccess } from "@/build/static/parseAst.js";
import { revertTable } from "@/indexing-store/utils/revert.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import {
  checkpointMax,
  decodeCheckpoint,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import { dedupe } from "@/utils/dedupe.js";
import { createPool } from "@/utils/pg.js";
import { Kysely, Migrator, PostgresDialect, Transaction, sql } from "kysely";
import type { Pool, PoolConfig } from "pg";
import type { DatabaseService, Metadata } from "../service.js";
import { migrationProvider } from "./migrations.js";

export class PostgresDatabaseService implements DatabaseService {
  kind = "postgres" as const;

  db: Kysely<any>;
  private pool: Pool;

  schema?: Schema;
  tableIds?: TableIds;
  metadata: Metadata[] = undefined!;

  private schemaName: string;

  constructor({
    common,
    poolConfig,
  }: {
    common: Common;
    poolConfig: PoolConfig;
  }) {
    this.schemaName = `ponder_core_${common.instanceId}`;

    const pool = createPool(poolConfig);
    this.pool = pool;

    this.db = new Kysely({
      dialect: new PostgresDialect({ pool }),
      log(event) {
        if (event.level === "query")
          common.metrics.ponder_postgres_query_count?.inc({ kind: "indexing" });
      },
    });
  }

  async setup() {
    await this.db.schema
      .createSchema("ponder_core_cache")
      .ifNotExists()
      .execute();

    const migrator = new Migrator({
      db: this.db,
      provider: migrationProvider,
      migrationTableSchema: "ponder_core_cache",
    });
    const result = await migrator.migrateToLatest();

    if (result.error) throw result.error;
  }

  async getIndexingDatabase() {
    return { pool: this.pool, schemaName: this.schemaName };
  }

  async getSyncDatabase() {
    const pluginSchemaName = "ponder_sync";
    await this.db.schema.createSchema(pluginSchemaName).ifNotExists().execute();
    return { pool: this.pool, schemaName: pluginSchemaName };
  }

  async kill() {
    try {
      await this.db.destroy();
    } catch (e) {
      // TODO: drop table
      const error = e as Error;
      if (error.message !== "Called end on pool more than once") {
        throw error;
      }
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

    await this.db.schema.createSchema(this.schemaName).ifNotExists().execute();

    const metadata = await this.db.transaction().execute(async (tx) => {
      await this.createTables(tx, "cache");
      await this.createTables(tx, "live");
      await this.copyTables(tx, "cache");
      const m = await tx
        .withSchema("cache")
        .selectFrom("metadata")
        .selectAll()
        .where("functionId", "in", _functionIds)
        .execute();

      return m;
    });

    this.metadata = metadata.map((m) => ({
      functionId: m.functionId,
      fromCheckpoint: m.fromCheckpoint
        ? decodeCheckpoint(m.fromCheckpoint)
        : null,
      toCheckpoint: decodeCheckpoint(m.toCheckpoint),
      eventCount: m.eventCount,
    }));

    // Table checkpoint is the minimum checkpoint of all the functions that write to it.
    for (const tableName of Object.keys(schema.tables)) {
      const indexingFunctionKeys = tableAccess
        .filter((t) => t.access === "write" && t.table === tableName)
        .map((t) => t.indexingFunctionKey);

      const tableMetadata = dedupe(indexingFunctionKeys).map((key) =>
        this.metadata.find((m) => m.functionId === functionIds[key]),
      );

      if (tableMetadata.some((m) => m === undefined)) continue;

      const checkpoints = tableMetadata.map((m) => m!.toCheckpoint);

      if (checkpoints.length === 0) continue;

      const tableCheckpoint = checkpointMax(...checkpoints);

      await revertTable(
        this.db.withSchema(this.schemaName),
        tableName,
        tableCheckpoint,
      );
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
          .withSchema("ponder_core_cache")
          .insertInto("metadata")
          .values(row)
          .onConflict((oc) => oc.column("functionId").doUpdateSet(row))
          .execute();
      }
    });
  }

  async publish() {
    // TODO(kevin)
    // search path
  }

  private dropCacheTables = (tx: Transaction<any>) =>
    Promise.all(
      Object.keys(this.schema!.tables).map((tableName) =>
        tx
          .withSchema("ponder_core_cache")
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
        const tx =
          database === "cache"
            ? _tx.withSchema("ponder_core_cache")
            : _tx.withSchema(this.schemaName);

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
            ? `"ponder_core_cache"."${this.tableIds![tableName]}"`
            : `"${this.schemaName}"."${tableName}_versioned"`;
        const toTable =
          fromDatabase === "cache"
            ? `"${this.schemaName}"."${tableName}_versioned"`
            : `"ponder_core_cache"."${this.tableIds![tableName]}"`;

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
  bigint: "numeric(78, 0)",
  hex: "bytea",
} as const;
