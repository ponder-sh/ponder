import path from "node:path";
import type { Common } from "@/Ponder.js";
import {
  type FunctionIds,
  HASH_VERSION,
  type TableIds,
} from "@/build/static/getFunctionAndTableIds.js";
import {
  type TableAccess,
  getTableAccessInverse,
  isWriteStoreMethod,
} from "@/build/static/getTableAccess.js";
import { NonRetryableError } from "@/errors/base.js";
import { revertTable } from "@/indexing-store/utils/revert.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import {
  type Checkpoint,
  checkpointMax,
  decodeCheckpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { type SqliteDatabase, createSqliteDatabase } from "@/utils/sqlite.js";
import { startClock } from "@/utils/timer.js";
import {
  CreateTableBuilder,
  Kysely,
  Migrator,
  SqliteDialect,
  WithSchemaPlugin,
  sql,
} from "kysely";
import prometheus from "prom-client";
import type { BaseDatabaseService, FunctionMetadata } from "../service.js";
import { type PonderCoreSchema, migrationProvider } from "./migrations.js";

const PUBLIC_DB_NAME = "ponder";
const CACHE_DB_NAME = "ponder_cache";

export class SqliteDatabaseService implements BaseDatabaseService {
  kind = "sqlite" as const;

  private common: Common;
  private directory: string;

  db: Kysely<PonderCoreSchema>;

  private sqliteDatabase: SqliteDatabase;
  private syncDatabase?: SqliteDatabase;

  schema?: Schema;
  tableIds?: TableIds;
  functionIds?: FunctionIds;
  tableAccess?: TableAccess;

  functionMetadata: FunctionMetadata[] = undefined!;
  isPublished = false;

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
        if (event.level === "query") {
          common.metrics.ponder_sqlite_query_total.inc({ database: "admin" });
        }
      },
    });

    this.registerMetrics();
  }

  getIndexingStoreConfig(): { database: SqliteDatabase } {
    return { database: this.sqliteDatabase };
  }

  getSyncStoreConfig(): { database: SqliteDatabase } {
    const syncDbPath = path.join(this.directory, "ponder_sync.db");
    this.syncDatabase = createSqliteDatabase(syncDbPath);
    return { database: this.syncDatabase };
  }

  async setup({
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
    this.functionIds = functionIds;
    this.tableAccess = tableAccess;

    return this.wrap({ method: "setup" }, async () => {
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

      // 4) Create the instance schema and tables.
      const { functionMetadata, tableMetadata } = await this.db
        .transaction()
        .execute(async (tx) => {
          // 3) Create tables in the instance schema, copying cached data if available.
          const tables = Object.entries(this.schema!.tables);
          await Promise.all(
            tables.map(async ([tableName, columns]) => {
              const tableId = this.tableIds![tableName];

              // a) Create a table in the instance schema.
              await tx.schema
                .createTable(tableName)
                .$call((builder) =>
                  this.buildColumns(builder, tableName, columns),
                )
                .execute();

              // b) Create a table in the cache schema if it doesn't already exist.
              await tx.schema
                .withSchema(CACHE_DB_NAME)
                .createTable(tableId)
                .$call((builder) =>
                  this.buildColumns(builder, tableId, columns),
                )
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

          // Get the functionMetadata for the data that we (maybe) copied over from the cache.
          const functionMetadata =
            functionIds_.length === 0
              ? []
              : await tx
                  .selectFrom("ponder_cache.function_metadata")
                  .selectAll()
                  .where("function_id", "in", functionIds_)
                  .execute();

          const tableIds_ = Object.values(tableIds);

          const tableMetadata =
            tableIds_.length === 0
              ? []
              : await tx
                  .selectFrom("ponder_cache.table_metadata")
                  .selectAll()
                  .where("table_id", "in", tableIds_)
                  .execute();

          return { functionMetadata, tableMetadata };
        });

      this.functionMetadata = functionMetadata.map((m) => ({
        functionId: m.function_id,
        functionName: m.function_name,
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
      await Promise.all(
        tableMetadata.map((m) => {
          return revertTable(
            this.db,
            m.table_name,
            decodeCheckpoint(m.to_checkpoint),
          );
        }),
      );
    });
  }

  async kill() {
    await this.wrap({ method: "kill" }, async () => {
      await this.db.destroy();
      this.syncDatabase?.close();
    });
  }

  async flush(metadata: FunctionMetadata[]): Promise<void> {
    return this.wrap({ method: "flush" }, async () => {
      this.common.logger.debug({
        service: "database",
        msg: `Starting flush with table IDs [${Object.values(
          this.tableIds!,
        ).join(", ")}] and function IDs [${Object.values(
          this.functionIds!,
        ).join(", ")}]`,
      });

      await this.db.transaction().execute(async (tx) => {
        const tables = Object.entries(this.schema!.tables);

        await Promise.all(
          tables.map(async ([tableName]) => {
            const tableId = this.tableIds![tableName];

            const tableMetadata = await tx
              .selectFrom("ponder_cache.table_metadata")
              .select("to_checkpoint")
              .where("table_id", "=", tableId)
              .executeTakeFirst();

            if (tableMetadata === undefined) {
              await tx.executeQuery(
                sql`INSERT INTO ${sql.raw(
                  `"${CACHE_DB_NAME}"."${tableId}"`,
                )} SELECT * FROM "${sql.raw(tableName)}"`.compile(tx),
              );
            } else {
              await tx.executeQuery(
                sql`WITH earliest_new_records AS (SELECT id, MIN(effective_from) as new_effective_to FROM "${sql.raw(
                  tableName,
                )}" WHERE effective_from > '${sql.raw(
                  tableMetadata.to_checkpoint,
                )}' GROUP BY id) UPDATE "${sql.raw(CACHE_DB_NAME)}"."${sql.raw(
                  tableId,
                )}" SET effective_to = earliest_new_records.new_effective_to FROM earliest_new_records WHERE "${sql.raw(
                  CACHE_DB_NAME,
                )}"."${sql.raw(tableId)}".id = earliest_new_records.id`.compile(
                  tx,
                ),
              );

              await tx.executeQuery(
                sql`INSERT INTO ${sql.raw(
                  `"${CACHE_DB_NAME}"."${tableId}"`,
                )} SELECT * FROM "${sql.raw(
                  tableName,
                )}" WHERE "effective_from" > '${sql.raw(
                  tableMetadata.to_checkpoint,
                )}'`.compile(tx),
              );
            }
          }),
        );

        const newFunctionMetadata = metadata.map((m) => ({
          function_id: m.functionId,
          function_name: m.functionName,
          hash_version: HASH_VERSION,
          from_checkpoint: m.fromCheckpoint
            ? encodeCheckpoint(m.fromCheckpoint)
            : null,
          to_checkpoint: encodeCheckpoint(m.toCheckpoint),
          event_count: m.eventCount,
        }));

        await Promise.all(
          newFunctionMetadata.map(async (metadata) => {
            await tx
              .insertInto("ponder_cache.function_metadata")
              .values(metadata)
              .onConflict((oc) =>
                oc.column("function_id").doUpdateSet(metadata),
              )
              .execute();
          }),
        );

        const newTableMetadata: Omit<
          PonderCoreSchema["ponder_cache.table_metadata"],
          "schema"
        >[] = [];

        const inverseTableAccess = getTableAccessInverse(this.tableAccess!);

        for (const [tableName, tableId] of Object.entries(this.tableIds!)) {
          const checkpoints: Checkpoint[] = [];

          // Table checkpoint is the max checkpoint of all the functions that write to the table
          for (const { indexingFunctionKey, storeMethod } of inverseTableAccess[
            tableName
          ] ?? []) {
            if (isWriteStoreMethod(storeMethod)) {
              const checkpoint = metadata.find(
                (m) => m.functionName === indexingFunctionKey,
              )?.toCheckpoint;
              if (checkpoint !== undefined) checkpoints.push(checkpoint);
            }
          }

          newTableMetadata.push({
            table_name: tableName,
            table_id: tableId,
            hash_version: HASH_VERSION,
            to_checkpoint:
              checkpoints.length === 0
                ? encodeCheckpoint(zeroCheckpoint)
                : encodeCheckpoint(checkpointMax(...checkpoints)),
          });
        }

        await Promise.all(
          newTableMetadata.map(async (metadata) => {
            await tx
              .insertInto("ponder_cache.table_metadata")
              .values({
                ...metadata,
                schema: JSON.stringify(
                  this.schema!.tables[metadata.table_name],
                ),
              })
              .onConflict((oc) => oc.column("table_id").doUpdateSet(metadata))
              .execute();
          }),
        );

        this.common.logger.debug({
          service: "database",
          msg: "Finished flush",
        });
      });
    });
  }

  async publish() {
    return this.wrap({ method: "publish" }, async () => {
      this.isPublished = true;
    });
  }

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
  float: "text",
  string: "text",
  bigint: "varchar(79)",
  hex: "blob",
} as const;
