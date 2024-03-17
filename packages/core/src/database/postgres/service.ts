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
import { NonRetryableError } from "@/common/errors.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import {
  type Checkpoint,
  checkpointMax,
  decodeCheckpoint,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import { formatEta } from "@/utils/format.js";
import { createPool } from "@/utils/pg.js";
import { startClock } from "@/utils/timer.js";
import {
  CreateTableBuilder,
  Kysely,
  Migrator,
  PostgresDialect,
  WithSchemaPlugin,
  sql,
} from "kysely";
import type { Pool, PoolConfig } from "pg";
import prometheus from "prom-client";
import type { BaseDatabaseService, FunctionMetadata } from "../service.js";
import { type PonderCoreSchema, migrationProvider } from "./migrations.js";

const ADMIN_POOL_SIZE = 3;

const PUBLIC_SCHEMA_NAME = "ponder";
const CACHE_SCHEMA_NAME = "ponder_cache";
const SYNC_SCHEMA_NAME = "ponder_sync";
const RAW_TABLE_PREFIX = "_raw_";

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
  private heartbeatInterval?: NodeJS.Timeout;

  schema?: Schema;
  tableIds?: TableIds;
  functionIds?: FunctionIds;
  tableAccess?: TableAccess;

  functionMetadata: FunctionMetadata[] = undefined!;
  isPublished = false;

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
        if (event.level === "query") {
          common.metrics.ponder_postgres_query_total.inc({ pool: "admin" });
        }
      },
    });

    this.registerMetrics();
  }

  getIndexingStoreConfig() {
    return { pool: this.indexingPool, schemaName: this.instanceSchemaName };
  }

  async getSyncStoreConfig() {
    await this.db.schema.createSchema(SYNC_SCHEMA_NAME).ifNotExists().execute();
    return { pool: this.syncPool, schemaName: SYNC_SCHEMA_NAME };
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

    await this.wrap({ method: "setup" }, async () => {
      // 1) Create the schemas if they don't exist.
      await Promise.all([
        this.db.schema.createSchema(CACHE_SCHEMA_NAME).ifNotExists().execute(),
        this.db.schema.createSchema(PUBLIC_SCHEMA_NAME).ifNotExists().execute(),
      ]);

      // 2) Run migrations.
      const migrator = new Migrator({
        db: this.db.withPlugin(new WithSchemaPlugin(CACHE_SCHEMA_NAME)),
        provider: migrationProvider,
        migrationTableSchema: CACHE_SCHEMA_NAME,
      });
      const result = await migrator.migrateToLatest();
      if (result.error) throw result.error;

      // 3) Drop schemas for stale instances, excluding the live instance (even if it's stale).
      await this.dropStaleInstanceSchemas();

      // 4) Create the instance schema and tables.
      const { functionMetadata } = await this.db
        .transaction()
        .execute(async (tx) => {
          // 1) Acquire an instance ID by inserting a row into the public metadata table.
          const metadataRow = await tx
            .insertInto("ponder_cache.instance_metadata")
            .values({
              hash_version: HASH_VERSION,
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
                .$call((builder) =>
                  this.buildColumns(builder, tableId, columns),
                )
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

          return { functionMetadata };
        });

      this.heartbeatInterval = setInterval(async () => {
        const updatedRow = await this.db
          .updateTable("ponder_cache.instance_metadata")
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
    });
  }

  async kill() {
    await this.wrap({ method: "kill" }, async () => {
      clearInterval(this.heartbeatInterval);

      // If this instance is not live, drop the instance schema and remove the metadata row.
      await this.db.transaction().execute(async (tx) => {
        const liveInstanceRow = await tx
          .selectFrom("ponder_cache.instance_metadata")
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
          .deleteFrom("ponder_cache.instance_metadata")
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
    });
  }

  async flush(metadata: FunctionMetadata[]): Promise<void> {
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

      if (checkpoints.length > 0) {
        newTableMetadata.push({
          table_id: tableId,
          table_name: tableName,
          hash_version: HASH_VERSION,
          to_checkpoint: encodeCheckpoint(checkpointMax(...checkpoints)),
        });
      }
    }

    await this.wrap({ method: "flush" }, async () => {
      this.common.logger.debug({
        service: "database",
        msg: `Starting flush for instance '${
          this.instanceId
        }' with table IDs [${Object.values(this.tableIds!).join(
          ", ",
        )}] and function IDs [${Object.values(this.functionIds!).join(", ")}]`,
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

            // new to_checkpoint of the table. Table may contain some rows that need to be truncated.
            const newTableToCheckpoint = newTableMetadata.find(
              (t) => t.table_id === tableId,
            )?.to_checkpoint;
            if (newTableToCheckpoint === undefined) return;

            if (tableMetadata === undefined) {
              await tx.executeQuery(
                sql`INSERT INTO ${sql.raw(
                  `"${CACHE_SCHEMA_NAME}"."${tableId}"`,
                )} SELECT * FROM "${sql.raw(
                  this.instanceSchemaName,
                )}"."${sql.raw(
                  tableName,
                )}" WHERE "effective_from" <= '${sql.raw(
                  newTableToCheckpoint,
                )}'`.compile(tx),
              );

              // Truncate cache tables to match metadata.
              await tx
                .withSchema(CACHE_SCHEMA_NAME)
                .updateTable(tableId)
                .set({ effective_to: "latest" })
                .where("effective_to", ">", newTableToCheckpoint)
                .execute();
            } else {
              // Update effective_to of overwritten rows
              await tx.executeQuery(
                sql`WITH earliest_new_records AS (SELECT id, MIN(effective_from) as new_effective_to FROM "${sql.raw(
                  this.instanceSchemaName,
                )}"."${sql.raw(tableName)}" WHERE effective_from > '${sql.raw(
                  tableMetadata.to_checkpoint,
                )}' GROUP BY id) UPDATE "${sql.raw(
                  CACHE_SCHEMA_NAME,
                )}"."${sql.raw(
                  tableId,
                )}" SET effective_to = earliest_new_records.new_effective_to FROM earliest_new_records WHERE "${sql.raw(
                  CACHE_SCHEMA_NAME,
                )}"."${sql.raw(
                  tableId,
                )}".id = earliest_new_records.id AND effective_to = 'latest'`.compile(
                  tx,
                ),
              );

              await tx.executeQuery(
                sql`INSERT INTO ${sql.raw(
                  `"${CACHE_SCHEMA_NAME}"."${tableId}"`,
                )} SELECT * FROM "${sql.raw(
                  this.instanceSchemaName,
                )}"."${sql.raw(tableName)}" WHERE "effective_from" > '${sql.raw(
                  tableMetadata.to_checkpoint,
                )}' AND "effective_from" <= '${sql.raw(
                  newTableToCheckpoint,
                )}'`.compile(tx),
              );

              await tx
                .withSchema(CACHE_SCHEMA_NAME)
                .updateTable(tableId)
                .set({ effective_to: "latest" })
                .where("effective_to", ">", newTableToCheckpoint)
                .execute();
            }
          }),
        );

        await Promise.all(
          newFunctionMetadata.map(async (metadata) => {
            await tx
              .insertInto("ponder_cache.function_metadata")
              .values(metadata)
              .onConflict((oc) =>
                oc.column("function_id").doUpdateSet(metadata as any),
              )
              .execute();
          }),
        );

        await Promise.all(
          newTableMetadata.map(async (metadata) => {
            await tx
              .insertInto("ponder_cache.table_metadata")
              .values({
                ...metadata,
                schema: JSON.stringify(
                  this.schema!.tables[metadata.table_name],
                ),
                hash_version: HASH_VERSION,
              })
              .onConflict((oc) =>
                oc.column("table_id").doUpdateSet(metadata as any),
              )
              .execute();
          }),
        );

        this.common.logger.debug({
          service: "database",
          msg: `Finished flush for instance '${this.instanceId}'`,
        });
      });
    });
  }

  async publish() {
    await this.wrap({ method: "publish" }, async () => {
      await this.db.transaction().execute(async (tx) => {
        // 1) Get the schema of the current live instance.
        const liveInstanceRow = await tx
          .selectFrom("ponder_cache.instance_metadata")
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

          await tx.schema
            .dropSchema(PUBLIC_SCHEMA_NAME)
            .ifExists()
            .cascade()
            .execute();
          await tx.schema.createSchema(PUBLIC_SCHEMA_NAME).execute();

          this.common.logger.debug({
            service: "database",
            msg: `Dropped 'ponder' schema created by previous live instance (${liveInstanceRow.instance_id})`,
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
            await tx.schema
              .withSchema(PUBLIC_SCHEMA_NAME)
              .createView(`${RAW_TABLE_PREFIX}${tableName}`)
              .as(
                (tx as Kysely<any>)
                  .withSchema(this.instanceSchemaName)
                  .selectFrom(tableName)
                  .selectAll(),
              )
              .execute();
          }),
        );

        this.common.logger.debug({
          service: "database",
          msg: `Created ${
            tables.length * 2
          } views in 'ponder' belonging to current instance (${
            this.instanceId
          })`,
        });

        // 4) Set "published_at" for this instance.
        await tx
          .updateTable("ponder_cache.instance_metadata")
          .where("instance_id", "=", this.instanceId)
          .set({ published_at: BigInt(Date.now()) })
          .execute();
      });
    });

    this.isPublished = true;
  }

  private async dropStaleInstanceSchemas() {
    await this.db.transaction().execute(async (tx) => {
      const liveInstanceRow = await tx
        .selectFrom("ponder_cache.instance_metadata")
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
        .deleteFrom("ponder_cache.instance_metadata")
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
          { service: "admin", method: options.method },
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
      service: "admin",
      method: options.method,
    });

    throw error;
  };

  private registerMetrics() {
    const service = this;

    this.common.metrics.registry.removeSingleMetric(
      "ponder_postgres_query_total",
    );
    this.common.metrics.ponder_postgres_query_total = new prometheus.Counter({
      name: "ponder_postgres_query_total",
      help: "Total number of queries submitted to the database",
      labelNames: ["pool"] as const,
      registers: [this.common.metrics.registry],
    });

    this.common.metrics.registry.removeSingleMetric(
      "ponder_postgres_pool_connections",
    );
    this.common.metrics.ponder_postgres_pool_connections = new prometheus.Gauge(
      {
        name: "ponder_postgres_pool_connections",
        help: "Number of connections in the pool",
        labelNames: ["pool", "kind"] as const,
        registers: [this.common.metrics.registry],
        collect() {
          this.set(
            { pool: "indexing", kind: "idle" },
            service.indexingPool.idleCount,
          );
          this.set({ pool: "sync", kind: "idle" }, service.syncPool.idleCount);
          this.set(
            { pool: "admin", kind: "idle" },
            service.adminPool.idleCount,
          );
          this.set(
            { pool: "indexing", kind: "total" },
            service.indexingPool.totalCount,
          );
          this.set(
            { pool: "sync", kind: "total" },
            service.syncPool.totalCount,
          );
          this.set(
            { pool: "admin", kind: "total" },
            service.adminPool.totalCount,
          );
        },
      },
    );

    this.common.metrics.registry.removeSingleMetric(
      "ponder_postgres_query_queue_size",
    );
    this.common.metrics.ponder_postgres_query_queue_size = new prometheus.Gauge(
      {
        name: "ponder_postgres_query_queue_size",
        help: "Number of query requests waiting for an available connection",
        labelNames: ["pool"] as const,
        registers: [this.common.metrics.registry],
        collect() {
          this.set({ pool: "indexing" }, service.indexingPool.waitingCount);
          this.set({ pool: "sync" }, service.syncPool.waitingCount);
          this.set({ pool: "admin" }, service.adminPool.waitingCount);
        },
      },
    );
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
