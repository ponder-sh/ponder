import type { Common } from "@/Ponder.js";
import type { FunctionIds, TableIds } from "@/build/static/ids.js";
import type { Schema } from "@/schema/types.js";
import { decodeCheckpoint, encodeCheckpoint } from "@/utils/checkpoint.js";
import {
  Kysely,
  Migrator,
  PostgresDialect,
  Transaction,
  WithSchemaPlugin,
} from "kysely";
import type { Pool } from "pg";
import type { DatabaseService, Metadata } from "../service.js";
import { migrationProvider } from "./migrations.js";

export class PostgresDatabaseService implements DatabaseService {
  kind = "postgres" as const;

  private common: Common;

  db: Kysely<any>;

  schema?: Schema;
  tableIds?: TableIds;
  metadata: Metadata[] = undefined!;

  private databaseSchemaName: string;

  constructor({
    common,
    pool,
  }: {
    common: Common;
    pool: Pool;
  }) {
    this.common = common;
    // TODO(kevin)
    this.databaseSchemaName = "public";

    this.db = new Kysely({
      dialect: new PostgresDialect({ pool }),
      log(event) {
        if (event.level === "query")
          common.metrics.ponder_postgres_query_count?.inc({ kind: "indexing" });
      },
    }).withPlugin(new WithSchemaPlugin(this.databaseSchemaName));
  }

  async setup() {
    const migrator = new Migrator({
      db: this.db,
      provider: migrationProvider,
      migrationTableSchema: "public",
    });
    const result = await migrator.migrateToLatest();
    if (result.error) throw result.error;
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

    const metadata = await this.db.transaction().execute(async (tx) => {
      // await this.createTables(tx, "cold");
      // await this.createTables(tx, "hot");
      // await this.copyTables(tx, "cold");
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
}

const scalarToSqlType = {
  boolean: "integer",
  int: "integer",
  float: "text",
  string: "text",
  bigint: "numeric(78, 0)",
  hex: "bytea",
} as const;
