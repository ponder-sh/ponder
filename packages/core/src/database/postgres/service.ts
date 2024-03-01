import type { Common } from "@/Ponder.js";
import type {
  FunctionIds,
  TableIds,
} from "@/build/static/getFunctionAndTableIds.js";
import {
  type TableAccess,
  getTableAccessInverse,
  isWriteStoreMethod,
} from "@/build/static/getTableAccess.js";
import { revertTable } from "@/indexing-store/utils/revert.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import {
  type Checkpoint,
  checkpointMax,
  decodeCheckpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { formatEta } from "@/utils/format.js";
import { createPool } from "@/utils/pg.js";
import {
  CreateTableBuilder,
  Kysely,
  Migrator,
  PostgresDialect,
  WithSchemaPlugin,
  sql,
} from "kysely";
import type { Pool, PoolConfig } from "pg";
import type { BaseDatabaseService, FunctionMetadata } from "../service.js";
import { type PonderCoreSchema, migrationProvider } from "./migrations.js";

const ADMIN_POOL_SIZE = 3;

const PUBLIC_SCHEMA_NAME = "ponder";
const CACHE_SCHEMA_NAME = "ponder_cache";

const HEARTBEAT_INTERVAL_MS = 10 * 1_000; // 10 seconds
const INSTANCE_TIMEOUT_MS = 60 * 1_000; // 1 minute

export class PostgresDatabaseService implements BaseDatabaseService {
  kind = "postgres" as const;

  private common: Common;
  private poolConfig: PoolConfig;
  /**
   * Small pool used by this service for cache management, zero-downtime logic,
   * and to cancel in-flight queries made by other pools on kill
   */
  private adminPool: Pool;
  db: Kysely<PonderCoreSchema>;

  private indexingPool: Pool;
  private syncPool: Pool;

  private instanceId: number = null!;
  private instanceSchemaName: string = null!;
  private heartbeatInterval: NodeJS.Timeout = null!;

  schema?: Schema;
  tableIds?: TableIds;
  functionIds?: FunctionIds;
  tableAccess?: TableAccess;

  functionMetadata: FunctionMetadata[] = undefined!;

  constructor({
    common,
    poolConfig,
  }: {
    common: Common;
    poolConfig: PoolConfig;
  }) {
    this.common = common;
    this.poolConfig = poolConfig;

    this.adminPool = createPool({
      ...poolConfig,
      min: ADMIN_POOL_SIZE,
      max: ADMIN_POOL_SIZE,
    });
    this.indexingPool = createPool(this.poolConfig);
    this.syncPool = createPool(this.poolConfig);

    this.db = new Kysely<PonderCoreSchema>({
      dialect: new PostgresDialect({ pool: this.adminPool }),
      log(event) {
        if (event.level === "error") console.log(event);
        if (event.level === "query") {
          common.metrics.ponder_postgres_query_count?.inc({ kind: "indexing" });
        }
      },
    });
  }

  getIndexingStoreConfig() {
    return { pool: this.indexingPool, schemaName: this.instanceSchemaName };
  }

  async getSyncStoreConfig() {
    const pluginSchemaName = "ponder_sync";
    await this.db.schema.createSchema(pluginSchemaName).ifNotExists().execute();
    return { pool: this.syncPool, schemaName: pluginSchemaName };
  }

  async kill() {
    clearInterval(this.heartbeatInterval);

    // If this instance is not live, drop the instance schema and remove the metadata row.
    await this.db.transaction().execute(async (tx) => {
      const liveInstanceRow = await tx
        .selectFrom("ponder._metadata")
        .select(["instance_id"])
        .where("published_at", "is not", null)
        .orderBy("published_at", "desc")
        .limit(1)
        .executeTakeFirst();

      if (liveInstanceRow?.instance_id === this.instanceId) {
        this.common.logger.debug({
          service: "database",
          msg: `Current instance (${this.instanceId}) is live, not dropping schema 'ponder_instance_${this.instanceId}'`,
        });
        return;
      }

      await tx.schema
        .dropSchema(this.instanceSchemaName)
        .ifExists()
        .cascade()
        .execute();
      await tx
        .deleteFrom("ponder._metadata")
        .where("instance_id", "=", this.instanceId)
        .execute();

      this.common.logger.debug({
        service: "database",
        msg: `Dropped schema for current instance (${this.instanceId})`,
      });
    });

    await this.adminPool.end();
    await this.indexingPool.end();
    await this.syncPool.end();
  }

  async setup() {
    // 1) Create the core cache schema if it doesn't exist.
    await this.db.schema
      .createSchema(CACHE_SCHEMA_NAME)
      .ifNotExists()
      .execute();

    // 2) Run cache schema migrations.
    const migrator = new Migrator({
      db: this.db.withPlugin(new WithSchemaPlugin(CACHE_SCHEMA_NAME)),
      provider: migrationProvider,
      migrationTableSchema: CACHE_SCHEMA_NAME,
    });
    const result = await migrator.migrateToLatest();
    if (result.error) throw result.error;

    // 3) Create public schema and metadata table if they don't exist.
    // TODO: Determine if these can happen in the migration.
    await this.db.schema
      .createSchema(PUBLIC_SCHEMA_NAME)
      .ifNotExists()
      .execute();
    await this.db.schema
      .createTable("ponder._metadata")
      .addColumn("instance_id", "serial", (col) => col.notNull().primaryKey()) // Auto-increment
      .addColumn("schema", "jsonb", (col) => col.notNull())
      .addColumn("created_at", "bigint", (col) => col.notNull())
      .addColumn("heartbeat_at", "bigint", (col) => col.notNull())
      .addColumn("published_at", "bigint")
      .ifNotExists()
      .execute();

    // 4) Drop schemas for stale instances, excluding the live instance (even if it's stale).
    await this.db.transaction().execute(async (tx) => {
      const liveInstanceRow = await tx
        .selectFrom("ponder._metadata")
        .selectAll()
        .where("published_at", "is not", null)
        .orderBy("published_at", "desc")
        .limit(1)
        .executeTakeFirst();

      if (liveInstanceRow) {
        const liveInstanceAge = formatEta(
          Date.now() - Number(liveInstanceRow.heartbeat_at),
        );
        this.common.logger.debug({
          service: "database",
          msg: `Another instance (${liveInstanceRow.instance_id}) is live, last heartbeat ${liveInstanceAge} ago`,
        });
      }

      let query = tx
        .deleteFrom("ponder._metadata")
        .returning(["instance_id"])
        .where("heartbeat_at", "<", BigInt(Date.now() - INSTANCE_TIMEOUT_MS));
      if (liveInstanceRow)
        query = query.where("instance_id", "!=", liveInstanceRow.instance_id);
      const staleInstanceIdRows = await query.execute();
      const staleInstanceIds = staleInstanceIdRows.map((r) => r.instance_id);

      if (staleInstanceIds.length > 0) {
        await Promise.all(
          staleInstanceIds.map((instanceId) =>
            tx.schema
              .dropSchema(`ponder_instance_${instanceId}`)
              .ifExists()
              .cascade()
              .execute(),
          ),
        );

        const s = staleInstanceIds.length > 1 ? "s" : "";
        this.common.logger.debug({
          service: "database",
          msg: `Dropped stale schema${s} for old instance${s} (${staleInstanceIds.join(
            ", ",
          )})`,
        });
      }
    });
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
    this.functionIds = functionIds;
    this.tableAccess = tableAccess;

    const { functionMetadata, tableMetadata } = await this.db
      .transaction()
      .execute(async (tx) => {
        // 1) Acquire an instance ID by inserting a row into the public metadata table.
        const metadataRow = await tx
          .insertInto("ponder._metadata")
          .values({
            schema: JSON.stringify(this.schema),
            created_at: BigInt(Date.now()),
            heartbeat_at: BigInt(Date.now()),
          })
          .returningAll()
          .executeTakeFirst();

        // Should not be possible for metadataRow to be undefined. If the insert fails, it will throw.
        this.instanceId = metadataRow!.instance_id;
        this.instanceSchemaName = `ponder_instance_${this.instanceId}`;

        // 2) Create the instance schema.
        await tx.schema
          .createSchema(this.instanceSchemaName)
          .ifNotExists()
          .execute();

        this.common.logger.debug({
          service: "database",
          msg: `Acquired instance_id (${this.instanceId}), created schema 'ponder_instance_${this.instanceId}'`,
        });

        // 3) Create tables in the instance schema, copying cached data if available.
        const tables = Object.entries(this.schema!.tables);
        await Promise.all(
          tables.map(async ([tableName, columns]) => {
            const tableId = this.tableIds![tableName];

            // a) Create a table in the instance schema.
            await tx.schema
              .withSchema(this.instanceSchemaName)
              .createTable(tableName)
              .$call((builder) =>
                this.buildColumns(builder, tableName, columns),
              )
              .execute();

            // b) Create a table in the cache schema if it doesn't already exist.
            await tx.schema
              .withSchema(CACHE_SCHEMA_NAME)
              .createTable(tableId)
              .$call((builder) => this.buildColumns(builder, tableId, columns))
              .ifNotExists()
              .execute();

            // c) Copy data from the cache table to the new table.
            await tx.executeQuery(
              sql`INSERT INTO ${sql.raw(
                `${this.instanceSchemaName}."${tableName}"`,
              )} (SELECT * FROM ${sql.raw(
                `${CACHE_SCHEMA_NAME}."${tableId}"`,
              )})`.compile(tx),
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

    this.heartbeatInterval = setInterval(async () => {
      const updatedRow = await this.db
        .updateTable("ponder._metadata")
        .where("instance_id", "=", this.instanceId)
        .set({ heartbeat_at: BigInt(Date.now()) })
        .returning(["heartbeat_at"])
        .executeTakeFirst();
      this.common.logger.debug({
        service: "database",
        msg: `Updated heartbeat timestamp to ${updatedRow?.heartbeat_at} (instance_id=${this.instanceId})`,
      });
    }, HEARTBEAT_INTERVAL_MS);

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
          this.db.withSchema(this.instanceSchemaName),
          m.table_name,
          decodeCheckpoint(m.to_checkpoint),
        );
      }),
    );
  }

  async flush(metadata: FunctionMetadata[]): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const tables = Object.entries(this.schema!.tables);

      await Promise.all(
        tables.map(async ([tableName, columns]) => {
          const tableId = this.tableIds![tableName];

          // 1) Drop existing cache table.
          await tx.schema
            .withSchema(CACHE_SCHEMA_NAME)
            .dropTable(tableId)
            .ifExists()
            .execute();

          // 2) Create new empty cache table.
          await tx.schema
            .withSchema(CACHE_SCHEMA_NAME)
            .createTable(tableId)
            .$call((builder) => this.buildColumns(builder, tableId, columns))
            .execute();

          // 3) Copy data from current indexing table to new cache table.
          await tx.executeQuery(
            sql`INSERT INTO ${sql.raw(
              `"${CACHE_SCHEMA_NAME}"."${tableId}"`,
            )} SELECT * FROM ${sql.raw(
              `"${this.instanceSchemaName}"."${tableName}"`,
            )}`.compile(tx),
          );
        }),
      );

      const newFunctionMetadata = metadata.map((m) => ({
        function_id: m.functionId,
        function_name: m.functionName,
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
            .onConflict((oc) => oc.column("function_id").doUpdateSet(metadata))
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
          to_checkpoint:
            checkpoints.length === 0
              ? encodeCheckpoint(maxCheckpoint)
              : encodeCheckpoint(checkpointMax(...checkpoints)),
        });
      }

      await Promise.all(
        newTableMetadata.map(async (metadata) => {
          await tx
            .insertInto("ponder_cache.table_metadata")
            .values({
              ...metadata,
              schema: JSON.stringify(this.schema!.tables[metadata.table_name]),
            })
            .onConflict((oc) => oc.column("table_id").doUpdateSet(metadata))
            .execute();
        }),
      );
    });
  }

  async publish() {
    await this.db.transaction().execute(async (tx) => {
      // 1) Get the schema of the current live instance.
      const liveInstanceRow = await tx
        .selectFrom("ponder._metadata")
        .selectAll()
        .where("published_at", "is not", null)
        .orderBy("published_at", "desc")
        .limit(1)
        .executeTakeFirst();

      // 2) If there is a published instance, drop its views from the public schema.
      if (liveInstanceRow !== undefined) {
        if (liveInstanceRow.instance_id === this.instanceId) {
          throw new Error(
            "Invariant violation: Attempted to publish twice within one process.",
          );
        }

        const liveTableNames = Object.keys(liveInstanceRow.schema.tables);

        await Promise.all(
          liveTableNames.map((tableName) =>
            tx.schema
              .withSchema(PUBLIC_SCHEMA_NAME)
              .dropView(tableName)
              .execute(),
          ),
        );

        this.common.logger.debug({
          service: "database",
          msg: `Dropped ${liveTableNames.length} views from 'ponder' belonging to previous instance (${liveInstanceRow.instance_id})`,
        });
      }

      // 3) Create views for this instance in the public schema.
      const tables = Object.entries(this.schema!.tables);
      await Promise.all(
        tables.map(async ([tableName, columns]) => {
          const viewColumnNames = Object.entries(columns)
            .filter(([, c]) => !isOneColumn(c) && !isManyColumn(c))
            .map(([name]) => name);
          await tx.schema
            .withSchema(PUBLIC_SCHEMA_NAME)
            .createView(tableName)
            .as(
              (tx as Kysely<any>)
                .withSchema(this.instanceSchemaName)
                .selectFrom(tableName)
                .select(viewColumnNames)
                .where("effective_to", "=", "latest"),
            )
            .execute();
        }),
      );

      this.common.logger.debug({
        service: "database",
        msg: `Created ${tables.length} views in 'ponder' belonging to current instance (${this.instanceId})`,
      });

      // 4) Set "published_at" for this instance.
      await tx
        .updateTable("ponder._metadata")
        .where("instance_id", "=", this.instanceId)
        .set({ published_at: BigInt(Date.now()) })
        .execute();
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
}

const scalarToSqlType = {
  boolean: "integer",
  int: "integer",
  float: "text",
  string: "text",
  bigint: "numeric(78, 0)",
  hex: "bytea",
} as const;
