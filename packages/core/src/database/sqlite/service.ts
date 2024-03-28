import fs from "node:fs";
import path from "node:path";
import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import { type SqliteDatabase, createSqliteDatabase } from "@/utils/sqlite.js";
import { startClock } from "@/utils/timer.js";
import {
  CreateTableBuilder,
  Kysely,
  Migrator,
  SqliteDialect,
  sql,
} from "kysely";
import prometheus from "prom-client";
import type { BaseDatabaseService } from "../service.js";
import { migrationProvider } from "./migrations.js";

const PUBLIC_DB_NAME = "ponder";
const SYNC_DB_NAME = "ponder_sync";

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

export class SqliteDatabaseService implements BaseDatabaseService {
  kind = "sqlite" as const;

  private common: Common;
  private directory: string;

  db: Kysely<PonderCoreSchema>;

  private sqliteDatabase: SqliteDatabase;
  private syncDatabase?: SqliteDatabase;

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

    fs.rmSync(publicDbPath, { force: true });
    this.sqliteDatabase = createSqliteDatabase(publicDbPath);

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
    const syncDbPath = path.join(this.directory, `${SYNC_DB_NAME}.db`);
    this.syncDatabase = createSqliteDatabase(syncDbPath);
    return { database: this.syncDatabase };
  }

  async setup({
    schema,
  }: {
    schema: Schema;
  }) {
    return this.wrap({ method: "setup" }, async () => {
      const migrator = new Migrator({
        db: this.db,
        provider: migrationProvider,
      });
      const result = await migrator.migrateToLatest();
      if (result.error) throw result.error;

      await this.db.schema
        .createTable("logs")
        .addColumn("id", "integer", (col) => col.notNull().primaryKey())
        .addColumn("table", "text", (col) => col.notNull())
        .addColumn("checkpoint", "varchar(58)", (col) => col.notNull())
        .addColumn("operation", "integer", (col) => col.notNull())
        .addColumn("row", "text")
        .execute();

      for (const [tableName, columns] of Object.entries(schema.tables)) {
        await this.db.schema
          .createTable(`${tableName}`)
          .$call((builder) => this.buildColumns(builder, schema, columns))
          // TODO(kyle) ifNotExists?
          .execute();
      }
    });
  }

  async kill() {
    await this.wrap({ method: "kill" }, async () => {
      await this.db.destroy();
      this.syncDatabase?.close();
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
  float: "real",
  string: "text",
  bigint: "varchar(79)",
  hex: "blob",
} as const;
