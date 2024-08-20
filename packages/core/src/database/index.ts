import path from "node:path";
import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import type { DatabaseConfig } from "@/config/database.js";
import type { Schema, Table } from "@/schema/common.js";
import {
  encodeSchema,
  getEnums,
  getTables,
  isEnumColumn,
  isJSONColumn,
  isListColumn,
  isManyColumn,
  isOneColumn,
  isOptionalColumn,
} from "@/schema/utils.js";
import type { PonderSyncSchema } from "@/sync-store/encoding.js";
import { migrationProvider as postgresMigrationProvider } from "@/sync-store/postgres/migrations.js";
import { migrationProvider as sqliteMigrationProvider } from "@/sync-store/sqlite/migrations.js";
import type { UserTable } from "@/types/schema.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { formatEta } from "@/utils/format.js";
import { createPool, createReadonlyPool } from "@/utils/pg.js";
import {
  type SqliteDatabase,
  createSqliteDatabase as _createSqliteDatabase,
  createReadonlySqliteDatabase,
} from "@/utils/sqlite.js";
import { wait } from "@/utils/wait.js";
import {
  type Kysely,
  Migrator,
  PostgresDialect,
  WithSchemaPlugin,
  sql as ksql,
} from "kysely";
import { SqliteDialect } from "kysely";
import type { Pool } from "pg";
import prometheus from "prom-client";
import { HeadlessKysely } from "./kysely.js";
import { revertIndexingTables } from "./revert.js";

export type Database<
  sql extends "sqlite" | "postgres" = "sqlite" | "postgres",
> = {
  sql: sql;
  namespace: string;
  driver: Driver<sql>;
  orm: ORM;
  migrateSync(): Promise<void>;
  // TODO(kyle) migrate
  /**
   * Prepare the database environment for a Ponder app.
   *
   * The core logic in this function reads the schema where the new
   * app will live, and decides what to do. Metadata is stored in the
   * "_ponder_meta" table, and any residual entries in this table are
   * used to determine what action this function will take.
   *
   * - If schema is empty, start
   * - If schema is locked, exit
   * - If cache hit (matching build_id), start
   * - If table name collision, exit
   * - Else, start
   */
  manageDatabaseEnv(args: { buildId: string }): Promise<{ checkpoint: string }>;
  revert(args: { checkpoint: string }): Promise<void>;
  updateFinalizedCheckpoint(args: { checkpoint: string }): Promise<void>;
  createIndexes(args: { schema: Schema }): Promise<void>;
  kill(): Promise<void>;
};

type PonderApp = {
  is_locked: boolean;
  is_dev: boolean;
  heartbeat_at: number;
  build_id: string;
  checkpoint: string;
  schema: string;
};

type PonderInternalSchema = {
  _ponder_meta: {
    key: "status" | "app";
    value: string | null;
  };
} & {
  [_: `_ponder_reorg_${string}`]: {
    id: unknown;
    operation_id: number;
    checkpoint: string;
    operation: 0 | 1 | 2;
  };
} & {
  [tableName: string]: UserTable;
};

type Driver<sql extends "sqlite" | "postgres"> = sql extends "sqlite"
  ? {
      user: SqliteDatabase;
      readonly: SqliteDatabase;
      sync: SqliteDatabase;
    }
  : {
      internal: Pool;
      user: Pool;
      readonly: Pool;
      sync: Pool;
    };

type ORM = {
  internal: HeadlessKysely<PonderInternalSchema>;
  user: HeadlessKysely<any>;
  readonly: HeadlessKysely<unknown>;
  sync: HeadlessKysely<PonderSyncSchema>;
};

const scalarToSqliteType = {
  boolean: "integer",
  int: "integer",
  float: "real",
  string: "text",
  bigint: "varchar(79)",
  hex: "blob",
} as const;

const scalarToPostgresType = {
  boolean: "integer",
  int: "integer",
  float: "float8",
  string: "text",
  bigint: "numeric(78, 0)",
  hex: "bytea",
} as const;

export const createDatabase = (args: {
  common: Common;
  schema: Schema;
  databaseConfig: DatabaseConfig;
}): Database => {
  let heartbeatInterval: NodeJS.Timeout | undefined;
  let namespace: string;

  ////////
  // Create drivers and orms
  ////////

  let sql: Database["sql"];
  let driver: Database["driver"];
  let orm: Database["orm"];

  if (args.databaseConfig.kind === "sqlite") {
    sql = "sqlite";
    namespace = "public";

    const userFile = path.join(args.databaseConfig.directory, "public.db");
    const syncFile = path.join(args.databaseConfig.directory, "ponder_sync.db");

    driver = {
      user: _createSqliteDatabase(userFile),
      readonly: createReadonlySqliteDatabase(userFile),
      sync: _createSqliteDatabase(syncFile),
    };

    driver.user.exec(`ATTACH DATABASE '${userFile}' AS public`);
    driver.readonly.exec(`ATTACH DATABASE '${userFile}' AS public`);
    // driver.readonly.exec(`ATTACH DATABASE '${syncFile}' AS public`);

    orm = {
      internal: new HeadlessKysely({
        name: "internal",
        common: args.common,
        dialect: new SqliteDialect({ database: driver.user }),
        log(event) {
          if (event.level === "query") {
            args.common.metrics.ponder_sqlite_query_total.inc({
              database: "internal",
            });
          }
        },
      }),
      user: new HeadlessKysely({
        name: "user",
        common: args.common,
        dialect: new SqliteDialect({ database: driver.user }),
        log(event) {
          if (event.level === "query") {
            args.common.metrics.ponder_sqlite_query_total.inc({
              database: "user",
            });
          }
        },
      }),
      readonly: new HeadlessKysely({
        name: "readonly",
        common: args.common,
        dialect: new SqliteDialect({ database: driver.readonly }),
        log(event) {
          if (event.level === "query") {
            args.common.metrics.ponder_sqlite_query_total.inc({
              database: "readonly",
            });
          }
        },
      }),
      sync: new HeadlessKysely<PonderSyncSchema>({
        name: "sync",
        common: args.common,
        dialect: new SqliteDialect({ database: driver.sync }),
        log(event) {
          if (event.level === "query") {
            args.common.metrics.ponder_sqlite_query_total.inc({
              database: "sync",
            });
          }
        },
      }),
    };
  } else {
    sql = "postgres";
    namespace = args.databaseConfig.schema;

    const internalMax = 2;
    const equalMax = Math.floor(
      (args.databaseConfig.poolConfig.max - internalMax) / 3,
    );
    const [readonlyMax, userMax, syncMax] =
      args.common.options.command === "serve"
        ? [args.databaseConfig.poolConfig.max - internalMax, 0, 0]
        : [equalMax, equalMax, equalMax];

    driver = {
      internal: createPool({
        ...args.databaseConfig.poolConfig,
        application_name: `${namespace}_internal`,
        max: internalMax,
        statement_timeout: 10 * 60 * 1000, // 10 minutes to accommodate slow sync store migrations.
      }),
      user: createPool({
        ...args.databaseConfig.poolConfig,
        application_name: `${namespace}_user`,
        max: userMax,
      }),
      readonly: createReadonlyPool({
        ...args.databaseConfig.poolConfig,
        application_name: `${namespace}_readonly`,
        max: readonlyMax,
      }),
      sync: createPool({
        ...args.databaseConfig.poolConfig,
        application_name: "ponder_sync",
        max: syncMax,
      }),
    };

    orm = {
      internal: new HeadlessKysely({
        name: "internal",
        common: args.common,
        dialect: new PostgresDialect({ pool: driver.internal }),
        log(event) {
          if (event.level === "query") {
            args.common.metrics.ponder_postgres_query_total.inc({
              pool: "internal",
            });
          }
        },
        plugins: [new WithSchemaPlugin(namespace)],
      }),
      user: new HeadlessKysely({
        name: "user",
        common: args.common,
        dialect: new PostgresDialect({ pool: driver.user }),
        log(event) {
          if (event.level === "query") {
            args.common.metrics.ponder_postgres_query_total.inc({
              pool: "user",
            });
          }
        },
        plugins: [new WithSchemaPlugin(namespace)],
      }),
      readonly: new HeadlessKysely({
        name: "readonly",
        common: args.common,
        dialect: new PostgresDialect({ pool: driver.readonly }),
        log(event) {
          if (event.level === "query") {
            args.common.metrics.ponder_postgres_query_total.inc({
              pool: "readonly",
            });
          }
        },
        plugins: [new WithSchemaPlugin(namespace)],
      }),
      sync: new HeadlessKysely<PonderSyncSchema>({
        name: "sync",
        common: args.common,
        dialect: new PostgresDialect({ pool: driver.sync }),
        log(event) {
          if (event.level === "query") {
            args.common.metrics.ponder_postgres_query_total.inc({
              pool: "sync",
            });
          }
        },
        plugins: [new WithSchemaPlugin("ponder_sync")],
      }),
    };
  }

  // Register metrics
  if (sql === "sqlite") {
    args.common.metrics.registry.removeSingleMetric(
      "ponder_sqlite_query_total",
    );
    args.common.metrics.ponder_sqlite_query_total = new prometheus.Counter({
      name: "ponder_sqlite_query_total",
      help: "Number of queries submitted to the database",
      labelNames: ["database"] as const,
      registers: [args.common.metrics.registry],
    });
  } else {
    args.common.metrics.registry.removeSingleMetric(
      "ponder_postgres_query_total",
    );
    args.common.metrics.ponder_postgres_query_total = new prometheus.Counter({
      name: "ponder_postgres_query_total",
      help: "Total number of queries submitted to the database",
      labelNames: ["pool"] as const,
      registers: [args.common.metrics.registry],
    });

    args.common.metrics.registry.removeSingleMetric(
      "ponder_postgres_pool_connections",
    );
    args.common.metrics.ponder_postgres_pool_connections = new prometheus.Gauge(
      {
        name: "ponder_postgres_pool_connections",
        help: "Number of connections in the pool",
        labelNames: ["pool", "kind"] as const,
        registers: [args.common.metrics.registry],
        collect() {
          this.set(
            { pool: "internal", kind: "idle" },
            // @ts-ignore
            driver.internal.idleCount,
          );
          this.set(
            { pool: "internal", kind: "total" },
            // @ts-ignore
            driver.internal.totalCount,
          );

          this.set(
            { pool: "sync", kind: "idle" },
            (driver.sync as Pool).idleCount,
          );
          this.set(
            { pool: "sync", kind: "total" },
            (driver.sync as Pool).totalCount,
          );

          this.set(
            { pool: "user", kind: "idle" },
            (driver.user as Pool).idleCount,
          );
          this.set(
            { pool: "user", kind: "total" },
            (driver.user as Pool).totalCount,
          );

          this.set(
            { pool: "readonly", kind: "idle" },
            (driver.readonly as Pool).idleCount,
          );
          this.set(
            { pool: "readonly", kind: "total" },
            (driver.readonly as Pool).totalCount,
          );
        },
      },
    );

    args.common.metrics.registry.removeSingleMetric(
      "ponder_postgres_query_queue_size",
    );
    args.common.metrics.ponder_postgres_query_queue_size = new prometheus.Gauge(
      {
        name: "ponder_postgres_query_queue_size",
        help: "Number of query requests waiting for an available connection",
        labelNames: ["pool"] as const,
        registers: [args.common.metrics.registry],
        collect() {
          // @ts-ignore
          this.set({ pool: "internal" }, driver.internal.waitingCount);
          this.set({ pool: "sync" }, (driver.sync as Pool).waitingCount);
          this.set({ pool: "user" }, (driver.user as Pool).waitingCount);
          this.set(
            { pool: "readonly" },
            (driver.readonly as Pool).waitingCount,
          );
        },
      },
    );
  }
  ////////
  // Helpers
  ////////

  const getApp = async (db: Kysely<PonderInternalSchema>) => {
    const row = await db
      .selectFrom("_ponder_meta")
      .where("key", "=", "app")
      .select("value")
      .executeTakeFirst();

    if (row === undefined) return undefined;
    const app: PonderApp =
      sql === "sqlite" ? JSON.parse(row.value!) : row.value;
    return app;
  };

  const encodeApp = (app: PonderApp) => {
    return sql === "sqlite" ? JSON.stringify(app) : (app as any);
  };

  return {
    sql,
    namespace,
    driver,
    orm,
    async migrateSync() {
      await orm.sync.wrap({ method: "migrateSyncStore" }, async () => {
        // TODO: Probably remove this at 1.0 to speed up startup time.
        // await moveLegacyTables({
        //   common: this.common,
        //   db: this.db as Kysely<any>,
        //   newSchemaName: "ponder_sync",
        // });

        let migrator: Migrator;

        if (sql === "sqlite") {
          migrator = new Migrator({
            db: orm.sync as any,
            provider: sqliteMigrationProvider,
          });
        } else {
          migrator = new Migrator({
            db: orm.sync as any,
            provider: postgresMigrationProvider,
            migrationTableSchema: "ponder_sync",
          });
        }

        const { error } = await migrator.migrateToLatest();
        if (error) throw error;
      });
    },
    async manageDatabaseEnv({ buildId }) {
      ////////
      // Migrate
      ////////

      // TODO(kyle) delete v3 database files

      // Create "_ponder_meta" table if it doesn't exist
      await orm.internal.schema
        .createTable("_ponder_meta")
        .addColumn("key", "text", (col) => col.primaryKey())
        .addColumn("value", "jsonb")
        .ifNotExists()
        .execute();

      const attempt = async () =>
        orm.internal.wrap({ method: "manageDatabaseEnv" }, () =>
          orm.internal.transaction().execute(async (tx) => {
            ////////
            // Create tables
            ////////

            const createUserTables = async () => {
              for (const [tableName, table] of Object.entries(
                getTables(args.schema),
              )) {
                await tx.schema
                  .createTable(tableName)
                  .$call((builder) => {
                    for (const [columnName, column] of Object.entries(
                      table.table,
                    )) {
                      if (isOneColumn(column)) continue;
                      if (isManyColumn(column)) continue;
                      if (isEnumColumn(column)) {
                        // Handle enum types
                        builder = builder.addColumn(
                          columnName,
                          "text",
                          (col) => {
                            if (isOptionalColumn(column) === false)
                              col = col.notNull();
                            if (isListColumn(column) === false) {
                              col = col.check(
                                ksql`${ksql.ref(columnName)} in (${ksql.join(
                                  getEnums(args.schema)[column[" enum"]]!.map(
                                    (v) => ksql.lit(v),
                                  ),
                                )})`,
                              );
                            }
                            return col;
                          },
                        );
                      } else if (isListColumn(column)) {
                        // Handle scalar list columns
                        builder = builder.addColumn(
                          columnName,
                          "text",
                          (col) => {
                            if (isOptionalColumn(column) === false)
                              col = col.notNull();
                            return col;
                          },
                        );
                      } else if (isJSONColumn(column)) {
                        // Handle json columns
                        builder = builder.addColumn(
                          columnName,
                          "jsonb",
                          (col) => {
                            if (isOptionalColumn(column) === false)
                              col = col.notNull();
                            return col;
                          },
                        );
                      } else {
                        // Non-list base columns
                        builder = builder.addColumn(
                          columnName,
                          (sql === "sqlite"
                            ? scalarToSqliteType
                            : scalarToPostgresType)[column[" scalar"]],
                          (col) => {
                            if (isOptionalColumn(column) === false)
                              col = col.notNull();
                            if (columnName === "id") col = col.primaryKey();
                            return col;
                          },
                        );
                      }
                    }

                    return builder;
                  })
                  .execute()
                  .catch((_error) => {
                    const error = _error as Error;
                    if (!error.message.includes("already exists")) throw error;
                    throw new NonRetryableError(
                      `Unable to create table '${namespace}'.'${tableName}' because a table with that name already exists. Is there another application using the '${namespace}' database scheme?`,
                    );
                  });

                args.common.logger.info({
                  service: "database",
                  msg: `Created table '${namespace}'.'${tableName}'`,
                });
              }
            };

            const createReorgTables = async () => {
              for (const [tableName, table] of Object.entries(
                getTables(args.schema),
              )) {
                await tx.schema
                  .createTable(`_ponder_reorg_${tableName}`)
                  .$call((builder) => {
                    for (const [columnName, column] of Object.entries(
                      table.table,
                    )) {
                      if (isOneColumn(column)) continue;
                      if (isManyColumn(column)) continue;
                      if (isEnumColumn(column)) {
                        // Handle enum types
                        // Omit the CHECK constraint because its included in the user table
                        builder = builder.addColumn(columnName, "text");
                      } else if (isListColumn(column)) {
                        // Handle scalar list columns
                        builder = builder.addColumn(columnName, "text");
                      } else if (isJSONColumn(column)) {
                        // Handle json columns
                        builder = builder.addColumn(columnName, "jsonb");
                      } else {
                        // Non-list base columns
                        builder = builder.addColumn(
                          columnName,
                          (sql === "sqlite"
                            ? scalarToSqliteType
                            : scalarToPostgresType)[column[" scalar"]],
                          (col) => {
                            if (columnName === "id") col = col.notNull();
                            return col;
                          },
                        );
                      }
                    }

                    builder = builder
                      .addColumn(
                        "operation_id",
                        sql === "sqlite" ? "integer" : "serial",
                        (col) => col.notNull().primaryKey(),
                      )
                      .addColumn("checkpoint", "varchar(75)", (col) =>
                        col.notNull(),
                      )
                      .addColumn("operation", "integer", (col) =>
                        col.notNull(),
                      );

                    return builder;
                  })
                  .execute();
              }
            };

            const previousApp = await getApp(tx);

            const newApp = {
              is_locked: true,
              is_dev: args.common.options.command === "dev",
              heartbeat_at: Date.now(),
              build_id: buildId,
              checkpoint: encodeCheckpoint(zeroCheckpoint),
              schema: encodeSchema(args.schema),
            } satisfies PonderApp;

            /**
             * If schema is empty, start
             */
            if (previousApp === undefined) {
              await tx
                .insertInto("_ponder_meta")
                .values([
                  { key: "status", value: null },
                  { key: "app", value: encodeApp(newApp) },
                ])
                .execute();
              args.common.logger.debug({
                service: "database",
                msg: `Acquired lock on schema '${namespace}'`,
              });

              await createUserTables();
              await createReorgTables();

              return {
                status: "success",
                checkpoint: encodeCheckpoint(zeroCheckpoint),
              } as const;
            }

            /**
             * If schema is locked, exit
             *
             * Determine if the schema is locked by examining the lock and heartbeat
             */
            const expiry =
              previousApp.heartbeat_at +
              args.common.options.databaseHeartbeatTimeout;

            if (
              previousApp.is_dev === false &&
              previousApp.is_locked &&
              Date.now() <= expiry
            ) {
              return { status: "locked", expiry } as const;
            }

            /**
             * If cache hit, start
             *
             * A cache hit occurs if the previous app has the same build id
             * as the new app. In this case, we can remove indexes, revert
             * unfinalized data and continue where it left off.
             */
            if (
              args.common.options.command !== "dev" &&
              previousApp.build_id === buildId &&
              previousApp.checkpoint !== encodeCheckpoint(zeroCheckpoint)
            ) {
              await tx
                .updateTable("_ponder_meta")
                .set({
                  value: encodeApp({
                    ...previousApp,
                    is_locked: true,
                    is_dev: false,
                    heartbeat_at: Date.now(),
                  }),
                })
                .where("key", "=", "app")
                .execute();

              args.common.logger.info({
                service: "database",
                msg: `Detected cache hit for build '${buildId}' in scheme '${namespace}' last active ${formatEta(Date.now() - previousApp.heartbeat_at)} ago`,
              });
              args.common.logger.debug({
                service: "database",
                msg: `Acquired lock on schema '${namespace}'`,
              });

              // Remove indexes
              for (const [tableName, table] of Object.entries(
                getTables(args.schema),
              )) {
                if (table.constraints === undefined) continue;

                for (const name of Object.keys(table.constraints)) {
                  await tx.schema
                    .dropIndex(`${tableName}_${name}`)
                    .ifExists()
                    .execute();

                  args.common.logger.info({
                    service: "database",
                    msg: `Dropped index '${tableName}_${name}' in schema '${namespace}'`,
                  });
                }
              }

              // Revert unfinalized data

              const { blockTimestamp, chainId, blockNumber } = decodeCheckpoint(
                previousApp.checkpoint,
              );
              args.common.logger.info({
                service: "database",
                msg: `Reverting operations prior to finalized checkpoint (timestamp=${blockTimestamp} chainId=${chainId} block=${blockNumber})`,
              });

              for (const tableName of Object.keys(getTables(args.schema))) {
                const rows = await tx
                  .deleteFrom(`_ponder_reorg_${tableName}`)
                  .returningAll()
                  .where("checkpoint", ">", previousApp.checkpoint)
                  .execute();

                const reversed = rows.sort(
                  (a, b) => b.operation_id - a.operation_id,
                );

                for (const log of reversed) {
                  if (log.operation === 0) {
                    // Create
                    await tx
                      .deleteFrom(tableName)
                      .where("id", "=", log.id as any)
                      .execute();
                  } else if (log.operation === 1) {
                    // Update

                    // @ts-ignore
                    log.operation_id = undefined;
                    // @ts-ignore
                    log.checkpoint = undefined;
                    // @ts-ignore
                    log.operation = undefined;
                    await tx
                      .updateTable(tableName)
                      .set(log as any)
                      .where("id", "=", log.id as any)
                      .execute();
                  } else {
                    // Delete

                    // @ts-ignore
                    log.operation_id = undefined;
                    // @ts-ignore
                    log.checkpoint = undefined;
                    // @ts-ignore
                    log.operation = undefined;
                    await tx
                      .insertInto(tableName)
                      .values(log as any)
                      .execute();
                  }
                }

                args.common.logger.info({
                  service: "database",
                  msg: `Reverted ${rows.length} unfinalized operations from existing '${tableName}' table`,
                });
              }

              return {
                status: "success",
                checkpoint: previousApp.checkpoint,
              } as const;
            }

            /**
             * If table name collision, exit
             * Else, start
             *
             * At this point in the control flow, the previous app has a
             * different build ID or a zero "checkpoint". We need to drop the
             * previous app's tables and create new ones.
             */

            await tx
              .updateTable("_ponder_meta")
              .set({ value: encodeApp(newApp) })
              .where("key", "=", "app")
              .execute();

            args.common.logger.debug({
              service: "database",
              msg: `Acquired lock on schema '${namespace}' previously used by build '${previousApp.build_id}'`,
            });

            // Drop old tables

            for (const tableName of Object.keys(
              JSON.parse(previousApp.schema).tables as {
                [tableName: string]: Table;
              },
            )) {
              await tx.schema
                .dropTable(`_ponder_reorg_${tableName}`)
                .ifExists()
                .execute();

              await tx.schema.dropTable(tableName).ifExists().execute();

              args.common.logger.debug({
                service: "database",
                msg: `Dropped '${tableName}' table left by previous build`,
              });
            }

            await createUserTables();
            await createReorgTables();

            return {
              status: "success",
              checkpoint: encodeCheckpoint(zeroCheckpoint),
            } as const;
          }),
        );

      let result = await attempt();
      if (result.status === "locked") {
        const duration = result.expiry - Date.now();
        args.common.logger.warn({
          service: "database",
          msg: `Schema '${namespace}' is locked by a different Ponder app`,
        });
        args.common.logger.warn({
          service: "database",
          msg: `Waiting ${formatEta(duration)} for lock on schema '${namespace} to expire...`,
        });

        await wait(duration);

        result = await attempt();
        if (result.status === "locked") {
          throw new NonRetryableError(
            `Failed to acquire lock on schema '${namespace}'. A different Ponder app is actively using this database.`,
          );
        }
      }

      heartbeatInterval = setInterval(async () => {
        try {
          const app = await getApp(orm.internal);
          await orm.internal
            .updateTable("_ponder_meta")
            .where("key", "=", "app")
            .set({
              value: encodeApp({ ...app!, heartbeat_at: Date.now() }),
            })
            .execute();

          args.common.logger.debug({
            service: "database",
            msg: `Updated heartbeat timestamp to ${app?.heartbeat_at} (build_id=${buildId})`,
          });
        } catch (err) {
          const error = err as Error;
          args.common.logger.error({
            service: "database",
            msg: `Failed to update heartbeat timestamp, retrying in ${formatEta(
              args.common.options.databaseHeartbeatInterval,
            )}`,
            error,
          });
        }
      }, args.common.options.databaseHeartbeatInterval);

      return { checkpoint: result.checkpoint };
    },
    async createIndexes() {
      await Promise.all(
        Object.entries(getTables(args.schema)).flatMap(([tableName, table]) => {
          if (table.constraints === undefined) return [];

          return Object.entries(table.constraints).map(
            async ([name, index]) => {
              await orm.internal.wrap({ method: "createIndexes" }, async () => {
                const indexName = `${tableName}_${name}`;

                const indexColumn = index[" column"];
                const order = index[" order"];
                const nulls = index[" nulls"];

                if (sql === "sqlite") {
                  const columns = Array.isArray(indexColumn)
                    ? indexColumn.map((ic) => `"${ic}"`).join(", ")
                    : `"${indexColumn}" ${order === "asc" ? "ASC" : order === "desc" ? "DESC" : ""}`;

                  await orm.internal.executeQuery(
                    ksql`CREATE INDEX ${ksql.ref(namespace)}.${ksql.ref(indexName)} ON ${ksql.table(
                      tableName,
                    )} (${ksql.raw(columns)})`.compile(orm.internal),
                  );
                } else {
                  const columns = Array.isArray(indexColumn)
                    ? indexColumn.map((ic) => `"${ic}"`).join(", ")
                    : `"${indexColumn}" ${order === "asc" ? "ASC" : order === "desc" ? "DESC" : ""} ${
                        nulls === "first"
                          ? "NULLS FIRST"
                          : nulls === "last"
                            ? "NULLS LAST"
                            : ""
                      }`;

                  await orm.internal.executeQuery(
                    ksql`CREATE INDEX ${ksql.ref(indexName)} ON ${ksql.table(
                      `${namespace}.${tableName}`,
                    )} (${ksql.raw(columns)})`.compile(orm.internal),
                  );
                }
              });

              args.common.logger.info({
                service: "database",
                msg: `Created index '${tableName}_${name}' on columns (${
                  Array.isArray(index[" column"])
                    ? index[" column"].join(", ")
                    : index[" column"]
                }) in schema '${namespace}'`,
              });
            },
          );
        }),
      );
    },
    revert({ checkpoint }) {
      return revertIndexingTables({
        checkpoint,
        db: orm.internal,
        schema: args.schema,
      });
    },
    async updateFinalizedCheckpoint({ checkpoint }) {
      await orm.internal.wrap(
        { method: "updateFinalizedCheckpoint" },
        async () => {
          const app = await getApp(orm.internal);
          await orm.internal
            .updateTable("_ponder_meta")
            .where("key", "=", "app")
            .set({
              value: encodeApp({ ...app!, checkpoint }),
            })
            .execute();
        },
      );

      const decoded = decodeCheckpoint(checkpoint);

      args.common.logger.debug({
        service: "database",
        msg: `Updated finalized checkpoint to (timestamp=${decoded.blockTimestamp} chainId=${decoded.chainId} block=${decoded.blockNumber})`,
      });
    },
    async kill() {
      clearInterval(heartbeatInterval);

      const app = await getApp(orm.internal);
      if (app) {
        await orm.internal
          .updateTable("_ponder_meta")
          .where("key", "=", "app")
          .set({
            value: encodeApp({ ...app, is_locked: false }),
          })
          .execute();
      }
      args.common.logger.debug({
        service: "database",
        msg: `Released lock on schema '${namespace}'`,
      });

      await orm.internal.destroy();
      await orm.user.destroy();
      await orm.readonly.destroy();
      await orm.sync.destroy();

      if (sql === "sqlite") {
        // @ts-ignore
        driver.user.close();
        // @ts-ignore
        driver.readonly.close();
        // @ts-ignore
        driver.sync.close();
      } else {
        // @ts-ignore
        await driver.internal.end();
        // @ts-ignore
        await driver.user.end();
        // @ts-ignore
        await driver.readonly.end();
        // @ts-ignore
        await driver.sync.end();
      }

      args.common.logger.debug({
        service: "database",
        msg: "Closed connection to database",
      });
    },
  };
};
