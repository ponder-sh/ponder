import type { Common } from "@/Ponder.js";
import type { FunctionIds, TableIds } from "@/build/static/ids.js";
import type { Schema } from "@/schema/types.js";
import { decodeCheckpoint, encodeCheckpoint } from "@/utils/checkpoint.js";
import { createPool } from "@/utils/pg.js";
import { Kysely, Migrator, PostgresDialect, Transaction } from "kysely";
import type { Pool, PoolConfig } from "pg";
import type { DatabaseService, Metadata } from "../service.js";
import { migrationProvider } from "./migrations.js";

export class PostgresDatabaseService implements DatabaseService {
  kind = "postgres" as const;

  private common: Common;

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
    this.common = common;
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
  }: {
    schema: Schema;
    tableIds: TableIds;
    functionIds: FunctionIds;
  }) {
    if (schema) this.schema = schema;
    if (tableIds) this.tableIds = tableIds;

    const _functionIds = Object.values(functionIds);

    await this.db.schema.createSchema(this.schemaName).ifNotExists().execute();

    const metadata = await this.db.transaction().execute(async (tx) => {
      // await this.createTables(tx, "cold");
      // await this.createTables(tx, "hot");
      // await this.copyTables(tx, "cold");
      return tx
        .withSchema("ponder_core_cache")
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
      await this.dropCacheTables(tx);
      // await this.createTables(tx, "cold");
      // await this.copyTables(tx, "hot");

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
}

const scalarToSqlType = {
  boolean: "integer",
  int: "integer",
  float: "text",
  string: "text",
  bigint: "numeric(78, 0)",
  hex: "bytea",
} as const;
