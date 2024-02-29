import path from "node:path";
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
import { type SqliteDatabase, createSqliteDatabase } from "@/utils/sqlite.js";
import {
  CreateTableBuilder,
  Kysely,
  Migrator,
  SqliteDialect,
  WithSchemaPlugin,
  sql,
} from "kysely";
import type { BaseDatabaseService, Metadata } from "../service.js";
import { type PonderCoreSchema, migrationProvider } from "./migrations.js";

const PUBLIC_DB_NAME = "ponder";
const CACHE_DB_NAME = "ponder_cache";

export class SqliteDatabaseService implements BaseDatabaseService {
  kind = "sqlite" as const;

  private common: Common;
  private directory: string;

  db: Kysely<PonderCoreSchema>;

  private sqliteDatabase: SqliteDatabase;

  schema?: Schema;
  tableIds?: TableIds;
  metadata: Metadata[] = undefined!;

  constructor({
    common,
    directory,
  }: {
    common: Common;
    directory: string;
  }) {
    this.common = common;
    this.directory = directory;

    const publicDbPath = path.join(directory, `${PUBLIC_DB_NAME}.db`);
    const cacheDbPath = path.join(directory, `${CACHE_DB_NAME}.db`);

    this.sqliteDatabase = createSqliteDatabase(publicDbPath);
    this.sqliteDatabase.exec(
      `ATTACH DATABASE '${cacheDbPath}' AS ${CACHE_DB_NAME}`,
    );

    this.db = new Kysely({
      dialect: new SqliteDialect({ database: this.sqliteDatabase }),
      log(event) {
        if (event.level === "error") console.log(event);
        if (event.level === "query") {
          common.metrics.ponder_sqlite_query_count?.inc({ kind: "indexing" });
        }
      },
    });
  }

  getIndexingStoreConfig(): { database: SqliteDatabase } {
    return { database: this.sqliteDatabase };
  }

  getSyncStoreConfig(): { database: SqliteDatabase } {
    const syncDbPath = path.join(this.directory, "ponder_sync.db");
    const syncDatabase = createSqliteDatabase(syncDbPath);
    return { database: syncDatabase };
  }

  async setup() {
    // 1) Run cache database migrations.
    const migrator = new Migrator({
      db: this.db.withPlugin(new WithSchemaPlugin(CACHE_DB_NAME)),
      provider: migrationProvider,
    });
    const result = await migrator.migrateToLatest();
    if (result.error) throw result.error;

    // 2) Drop any existing tables in the public database.
    const existingTableRows = await this.db.executeQuery<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table'`.compile(this.db),
    );
    const existingTableNames = existingTableRows.rows.map((row) => row.name);

    if (existingTableNames.length > 0) {
      await this.db.transaction().execute(async (tx) => {
        await Promise.all(
          existingTableNames.map((tableName) =>
            tx.schema.dropTable(tableName).ifExists().execute(),
          ),
        );
      });

      const s = existingTableNames.length > 1 ? "s" : "";
      this.common.logger.debug({
        service: "database",
        msg: `Dropped stale table${s} from ponder.db (${existingTableNames.join(
          ", ",
        )})`,
      });
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
    this.schema = schema;
    this.tableIds = tableIds;

    const metadata = await this.db.transaction().execute(async (tx) => {
      // 3) Create tables in the instance schema, copying cached data if available.
      const tables = Object.entries(this.schema!.tables);
      await Promise.all(
        tables.map(async ([tableName, columns]) => {
          const tableId = this.tableIds![tableName];

          // a) Create a table in the instance schema.
          await tx.schema
            .createTable(tableName)
            .$call((builder) => this.buildColumns(builder, tableName, columns))
            .execute();

          // b) Create a table in the cache schema if it doesn't already exist.
          await tx.schema
            .withSchema(CACHE_DB_NAME)
            .createTable(tableId)
            .$call((builder) => this.buildColumns(builder, tableId, columns))
            .ifNotExists()
            .execute();

          // c) Copy data from the cache table to the new table.
          await tx.executeQuery(
            sql`INSERT INTO "${sql.raw(tableName)}" SELECT * FROM ${sql.raw(
              `"${CACHE_DB_NAME}"."${tableId}"`,
            )}`.compile(tx),
          );
        }),
      );

      const functionIds_ = Object.values(functionIds);
      if (functionIds_.length === 0) return [];

      const metadata = await tx
        .selectFrom("ponder_cache.function_metadata")
        .selectAll()
        .where("function_id", "in", functionIds_)
        .execute();

      return metadata;
    });

    this.metadata = metadata.map((m) => ({
      functionId: m.function_id,
      fromCheckpoint: m.from_checkpoint
        ? decodeCheckpoint(m.from_checkpoint)
        : null,
      toCheckpoint: decodeCheckpoint(m.to_checkpoint),
      eventCount: m.event_count,
    }));

    /**
     * 4) Truncate cache tables to match metadata checkpoints.
     *
     * It's possible for the cache tables to contain more data than the metadata indicates.
     * To avoid copying unfinalized data left over from a previous instance, we must revert
     * the instance tables to the checkpoint saved in the metadata after copying from the cache.
     * In other words, metadata checkpoints are always <= actual rows in the corresponding table.
     */
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

      await revertTable(this.db, tableName, tableCheckpoint);
    }
  }

  async kill() {
    // TODO(kyle): Flush here?

    await this.db.destroy();
  }

  async flush(metadata: Metadata[]): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const tables = Object.entries(this.schema!.tables);

      await Promise.all(
        tables.map(async ([tableName, columns]) => {
          const tableId = this.tableIds![tableName];

          // 1) Drop existing cache table.
          await tx.schema
            .withSchema(CACHE_DB_NAME)
            .dropTable(tableId)
            .ifExists()
            .execute();

          // 2) Create new empty cache table.
          await tx.schema
            .withSchema(CACHE_DB_NAME)
            .createTable(tableId)
            .$call((builder) => this.buildColumns(builder, tableId, columns))
            .execute();

          // 3) Copy data from current indexing table to new cache table.
          await tx.executeQuery(
            sql`INSERT INTO ${sql.raw(
              `"${CACHE_DB_NAME}"."${tableId}"`,
            )} SELECT * FROM "${sql.raw(tableName)}"`.compile(tx),
          );
        }),
      );

      const newMetadata = metadata.map((m) => ({
        function_id: m.functionId,
        from_checkpoint: m.fromCheckpoint
          ? encodeCheckpoint(m.fromCheckpoint)
          : null,
        to_checkpoint: encodeCheckpoint(m.toCheckpoint),
        event_count: m.eventCount,
      }));

      await Promise.all(
        newMetadata.map(async (metadata) => {
          await tx
            .insertInto("ponder_cache.function_metadata")
            .values(metadata)
            .onConflict((oc) => oc.column("function_id").doUpdateSet(metadata))
            .execute();
        }),
      );
    });
  }

  // No-op.
  async publish() {}

  private buildColumns(
    builder: CreateTableBuilder<string>,
    tableId: string,
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
                this.schema!.enums[column.type].map((v) => sql.lit(v)),
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
            return col;
          },
        );
      }
    });

    builder = builder.addColumn("effective_from", "varchar(58)", (col) =>
      col.notNull(),
    );
    builder = builder.addColumn("effective_to", "varchar(58)", (col) =>
      col.notNull(),
    );
    builder = builder.addPrimaryKeyConstraint(
      `${tableId}_id_checkpoint_unique`,
      ["id", "effective_to"] as never[],
    );

    return builder;
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
