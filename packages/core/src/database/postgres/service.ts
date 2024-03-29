import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import type { Checkpoint } from "@/utils/checkpoint.js";
import { createPool } from "@/utils/pg.js";
import { startClock } from "@/utils/timer.js";
import { CreateTableBuilder, Kysely, PostgresDialect, sql } from "kysely";
import type { Pool, PoolConfig } from "pg";
import prometheus from "prom-client";
import type { BaseDatabaseService, FunctionMetadata } from "../service.js";

const ADMIN_POOL_SIZE = 3;

const PUBLIC_SCHEMA_NAME = "ponder";
const SYNC_SCHEMA_NAME = "ponder_sync";

export type PonderCoreSchema = {
  "ponder.logs": {
    id: number;
    table: string;
    row: Object | null;
    checkpoint: string;
    type: 0 | 1 | 2;
  };
} & {
  [table: string]: {
    id: unknown;
    [column: string]: unknown;
  };
};

export class PostgresDatabaseService implements BaseDatabaseService {
  kind = "postgres" as const;

  private common: Common;
  private poolConfig: PoolConfig;

  /**
   * Small pool used by this service for creating tables.
   */
  private adminPool: Pool;
  db: Kysely<PonderCoreSchema>;

  private indexingPool: Pool;
  private syncPool: Pool;

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
        if (event.level === "query") {
          common.metrics.ponder_postgres_query_total.inc({ pool: "admin" });
        }
      },
    });

    this.registerMetrics();
  }

  getIndexingStoreConfig() {
    return { pool: this.indexingPool };
  }

  async getSyncStoreConfig() {
    await this.db.schema.createSchema(SYNC_SCHEMA_NAME).ifNotExists().execute();
    return { pool: this.syncPool, schemaName: SYNC_SCHEMA_NAME };
  }

  async revert({ checkpoint }: { checkpoint: Checkpoint }) {}

  async setup({
    schema,
  }: {
    schema: Schema;
  }) {
    await this.wrap({ method: "setup" }, async () => {
      await this.db.schema
        .dropSchema(PUBLIC_SCHEMA_NAME)
        .ifExists()
        .cascade()
        .execute();
      await this.db.schema
        .createSchema(PUBLIC_SCHEMA_NAME)
        .ifNotExists()
        .execute();

      await this.db.schema
        .withSchema("ponder")
        .createTable("logs")
        .addColumn("id", "serial", (col) => col.notNull().primaryKey())
        .addColumn("tableName", "text", (col) => col.notNull())
        .addColumn("checkpoint", "varchar(58)", (col) => col.notNull())
        .addColumn("operation", "integer", (col) => col.notNull())
        .addColumn("row", "text", (col) => col.notNull())
        .execute();

      const tables = Object.entries(schema.tables);
      await Promise.all(
        tables.map(async ([tableName, columns]) => {
          await this.db.schema
            .withSchema("ponder")
            .createTable(tableName)
            .$call((builder) => this.buildColumns(builder, schema, columns))
            .execute();
        }),
      );
    });
  }

  async kill() {
    await this.wrap({ method: "kill" }, async () => {
      await this.indexingPool.end();
      await this.syncPool.end();
    });
  }

  private buildColumns(
    builder: CreateTableBuilder<string>,
    schema: Schema,
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
                schema.enums[column.type].map((v) => sql.lit(v)),
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
            if (columnName === "id") col = col.primaryKey();
            return col;
          },
        );
      }
    });

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
  float: "float8",
  string: "text",
  bigint: "numeric(78, 0)",
  hex: "bytea",
} as const;
