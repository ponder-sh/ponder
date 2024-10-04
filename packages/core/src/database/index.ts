import fs from "node:fs";
import path from "node:path";
import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import type { DatabaseConfig } from "@/config/database.js";
import { type Drizzle, type Schema, onchain } from "@/drizzle/index.js";
import { generateTableSQL, getPrimaryKeyColumns } from "@/drizzle/sql.js";
import type { PonderSyncSchema } from "@/sync-store/encoding.js";
import {
  moveLegacyTables,
  migrationProvider as postgresMigrationProvider,
} from "@/sync-store/postgres/migrations.js";
import { migrationProvider as sqliteMigrationProvider } from "@/sync-store/sqlite/migrations.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { formatEta } from "@/utils/format.js";
import { createPool } from "@/utils/pg.js";
import {
  type SqliteDatabase,
  createReadonlySqliteDatabase,
  createSqliteDatabase,
} from "@/utils/sqlite.js";
import { wait } from "@/utils/wait.js";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { drizzle as createDrizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  PgTable,
  getTableConfig,
  integer,
  pgTable,
  serial,
  varchar,
} from "drizzle-orm/pg-core";
import {
  Migrator,
  PostgresDialect,
  SqliteDialect,
  type Transaction,
  WithSchemaPlugin,
  sql,
} from "kysely";
import type { Pool } from "pg";
import prometheus from "prom-client";
import { HeadlessKysely } from "./kysely.js";

export type Database<
  dialect extends "sqlite" | "postgres" = "sqlite" | "postgres",
> = {
  dialect: dialect;
  namespace: string;
  driver: Driver<dialect>;
  qb: QueryBuilder;
  drizzle: Drizzle<Schema>;
  migrateSync(): Promise<void>;
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
   * - Drop old tables
   * - If table name collision, exit
   * - Else, start
   */
  setup(args: { buildId: string }): Promise<{ checkpoint: string }>;
  createTriggers(): Promise<void>;
  revert(args: { checkpoint: string }): Promise<void>;
  finalize(args: { checkpoint: string }): Promise<void>;
  // createIndexes(args: { schema: Schema }): Promise<void>;
  complete(args: { checkpoint: string }): Promise<void>;
  kill(): Promise<void>;
};

type PonderApp = {
  is_locked: 0 | 1;
  is_dev: 0 | 1;
  heartbeat_at: number;
  build_id: string;
  checkpoint: string;
  table_names: string[];
};

type PonderInternalSchema = {
  _ponder_meta: {
    key: "status" | "app";
    value: string | null;
  };
} & {
  [_: `_ponder_reorg__${string}`]: {
    operation_id: number;
    checkpoint: string;
    operation: 0 | 1 | 2;
  };
};

type Driver<dialect extends "sqlite" | "postgres"> = dialect extends "sqlite"
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

type QueryBuilder = {
  /** For updating metadata and handling reorgs */
  internal: HeadlessKysely<PonderInternalSchema>;
  /** For indexing-store methods in user code */
  user: HeadlessKysely<any>;
  /** Used in api functions */
  readonly: HeadlessKysely<unknown>;
  /** Used to interact with the sync-store */
  sync: HeadlessKysely<PonderSyncSchema>;
};

export const createDatabase = async (args: {
  common: Common;
  schema: Schema;
  databaseConfig: DatabaseConfig;
}): Promise<Database> => {
  let heartbeatInterval: NodeJS.Timeout | undefined;
  let namespace: string;

  ////////
  // Create drivers and orms
  ////////

  let dialect: Database["dialect"];
  let driver: Database["driver"];
  let qb: Database["qb"];

  if (args.databaseConfig.kind === "sqlite") {
    dialect = "sqlite";
    namespace = "public";

    const userFile = path.join(args.databaseConfig.directory, "public.db");
    const syncFile = path.join(args.databaseConfig.directory, "ponder_sync.db");

    driver = {
      user: createSqliteDatabase(userFile),
      readonly: createReadonlySqliteDatabase(userFile),
      sync: createSqliteDatabase(syncFile),
    };

    qb = {
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
    dialect = "postgres";
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
      readonly: createPool({
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

    qb = {
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

  /**
   * Reset the prototype so `table instanceof PgTable` evaluates to true.
   */
  for (const table of Object.values(args.schema)) {
    // @ts-ignore
    if (onchain in table) {
      Object.setPrototypeOf(table, PgTable.prototype);
    }
  }

  const drizzle = createDrizzle(driver.user as Pool, args.schema);

  if (fs.existsSync(args.common.options.migrationsDir)) {
    await migrate(drizzle, {
      migrationsFolder: args.common.options.migrationsDir,
    });
  }

  // Register metrics
  if (dialect === "sqlite") {
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

  const encodeApp = (app: PonderApp) => {
    return dialect === "sqlite" ? JSON.stringify(app) : (app as any);
  };

  /**
   * Undo operations in user tables by using the `_ponder_reorg` metadata.
   *
   * Note: `_ponder_reorg` tables may contain operations that have not been applied to the
   *       underlying tables, but only be 1 operation at most.
   */
  const revert = async ({
    tableName,
    checkpoint,
    tx,
  }: {
    tableName: string;
    checkpoint: string;
    tx: Transaction<PonderInternalSchema>;
  }) => {
    const primaryKeyColumns = getPrimaryKeyColumns(
      args.schema[tableName] as PgTable,
    );

    const rows = await tx
      .deleteFrom(`_ponder_reorg__${tableName}`)
      .returningAll()
      .where("checkpoint", ">", checkpoint)
      .execute();

    const reversed = rows.sort((a, b) => b.operation_id - a.operation_id);

    // undo operation
    for (const log of reversed) {
      if (log.operation === 0) {
        // Create
        await tx
          // @ts-ignore
          .deleteFrom(tableName)
          .$call((qb) => {
            for (const name of primaryKeyColumns) {
              // @ts-ignore
              qb = qb.where(name, "=", log[name]);
            }
            return qb;
          })
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
          // @ts-ignore
          .updateTable(tableName)
          .set(log as any)
          .$call((qb) => {
            for (const name of primaryKeyColumns) {
              // @ts-ignore
              qb = qb.where(name, "=", log[name]);
            }
            return qb;
          })
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
          // @ts-ignore
          .insertInto(tableName)
          .values(log as any)
          // @ts-ignore
          .onConflict((oc) => oc.columns(primaryKeyColumns).doNothing())
          .execute();
      }
    }

    args.common.logger.info({
      service: "database",
      msg: `Reverted ${rows.length} unfinalized operations from '${tableName}' table`,
    });
  };

  return {
    dialect,
    namespace,
    driver,
    qb,
    drizzle,
    async migrateSync() {
      await qb.sync.wrap({ method: "migrateSyncStore" }, async () => {
        // TODO: Probably remove this at 1.0 to speed up startup time.
        // TODO(kevin) is the `WithSchemaPlugin` going to break this?
        if (dialect === "postgres") {
          await moveLegacyTables({
            common: args.common,
            // @ts-expect-error
            db: qb.internal,
            newSchemaName: "ponder_sync",
          });
        }

        let migrator: Migrator;

        if (dialect === "sqlite") {
          migrator = new Migrator({
            db: qb.sync as any,
            provider: sqliteMigrationProvider,
          });
        } else {
          migrator = new Migrator({
            db: qb.sync as any,
            provider: postgresMigrationProvider,
            migrationTableSchema: "ponder_sync",
          });
        }

        const { error } = await migrator.migrateToLatest();
        if (error) throw error;
      });
    },
    async setup({ buildId }) {
      const tableNames = Object.values(args.schema)
        .filter((table): table is PgTable => is(table, PgTable))
        .map((table) => getTableConfig(table).name);

      ////////
      // Migrate
      ////////

      // v0.4 migration ???

      // v0.6 migration

      if (args.databaseConfig.kind === "sqlite") {
        const ponderFile = path.join(
          args.databaseConfig.directory,
          "ponder.db",
        );
        if (fs.existsSync(ponderFile)) {
          const _driver = createSqliteDatabase(ponderFile);
          const _orm = new HeadlessKysely<any>({
            name: "user",
            common: args.common,
            dialect: new SqliteDialect({ database: _driver }),
          });
          await qb.internal.wrap({ method: "setup" }, async () => {
            const namespaceCount = await _orm
              .selectFrom("namespace_lock")
              .select(sql`count(*)`.as("count"))
              .executeTakeFirst();

            const tableNames = await _orm
              .selectFrom("namespace_lock")
              .select("schema")
              .where("namespace", "=", namespace)
              .executeTakeFirst()
              .then((schema) =>
                schema === undefined
                  ? undefined
                  : Object.keys(JSON.parse(schema.schema).tables),
              );
            if (tableNames) {
              for (const tableName of tableNames) {
                await qb.internal.schema
                  .dropTable(tableName)
                  .ifExists()
                  .execute();
              }

              await _orm
                .deleteFrom("namespace_lock")
                .where("namespace", "=", namespace)
                .execute();

              await _orm.destroy();
              _driver.close();

              if (namespaceCount!.count === 1) {
                fs.rmSync(
                  // @ts-ignore
                  path.join(args.databaseConfig.directory, "ponder.db"),
                  {
                    force: true,
                  },
                );
                fs.rmSync(
                  // @ts-ignore
                  path.join(args.databaseConfig.directory, "ponder.db-shm"),
                  {
                    force: true,
                  },
                );
                fs.rmSync(
                  // @ts-ignore
                  path.join(args.databaseConfig.directory, "ponder.db-wal"),
                  {
                    force: true,
                  },
                );
                args.common.logger.debug({
                  service: "database",
                  msg: `Removed '.ponder/sqlite/ponder.db' file`,
                });
              }
            }
          });
        }
      } else {
        const hasPonderSchema = await qb.internal
          // @ts-ignore
          .selectFrom("information_schema.schemata")
          // @ts-ignore
          .select("schema_name")
          // @ts-ignore
          .where("schema_name", "=", "ponder")
          .executeTakeFirst()
          .then((schema) => schema?.schema_name === "ponder");

        if (hasPonderSchema) {
          await qb.internal.wrap({ method: "setup" }, async () => {
            const namespaceCount = await qb.internal
              .withSchema("ponder")
              // @ts-ignore
              .selectFrom("namespace_lock")
              .select(sql`count(*)`.as("count"))
              .executeTakeFirst();

            const tableNames = await qb.internal
              .withSchema("ponder")
              // @ts-ignore
              .selectFrom("namespace_lock")
              // @ts-ignore
              .select("schema")
              // @ts-ignore
              .where("namespace", "=", namespace)
              .executeTakeFirst()
              .then((schema: any | undefined) =>
                schema === undefined
                  ? undefined
                  : Object.keys(schema.schema.tables),
              );
            if (tableNames) {
              for (const tableName of tableNames) {
                await qb.internal.schema
                  .dropTable(tableName)
                  .ifExists()
                  .cascade()
                  .execute();
              }

              await qb.internal
                .withSchema("ponder")
                // @ts-ignore
                .deleteFrom("namespace_lock")
                // @ts-ignore
                .where("namespace", "=", namespace)
                .execute();

              if (namespaceCount!.count === 1) {
                await qb.internal.schema
                  .dropSchema("ponder")
                  .cascade()
                  .execute();

                args.common.logger.debug({
                  service: "database",
                  msg: `Removed 'ponder' schema`,
                });
              }
            }
          });
        }
      }

      await qb.internal.wrap({ method: "setup" }, async () => {
        if (dialect === "postgres") {
          await qb.internal.schema
            .createSchema(namespace)
            .ifNotExists()
            .execute();
        }

        // Create "_ponder_meta" table if it doesn't exist
        await qb.internal.schema
          .createTable("_ponder_meta")
          .addColumn("key", "text", (col) => col.primaryKey())
          .addColumn("value", "jsonb")
          .ifNotExists()
          .execute();
      });

      const attempt = async () =>
        qb.internal.wrap({ method: "setup" }, () =>
          qb.internal.transaction().execute(async (tx) => {
            ////////
            // Create tables
            ////////

            const createUserTables = async () => {
              for (const table of Object.values(args.schema)) {
                if (is(table, PgTable)) {
                  await sql
                    .raw(generateTableSQL({ table, namespace }))
                    .execute(tx);

                  args.common.logger.info({
                    service: "database",
                    msg: `Created table '${namespace}'.'${getTableName(table)}'`,
                  });
                }
              }
            };

            const createReorgTables = async () => {
              for (const table of Object.values(args.schema)) {
                if (is(table, PgTable)) {
                  const extraColumns = Object.values(
                    pgTable("", {
                      operation_id: serial("operation_id")
                        .notNull()
                        .primaryKey(),
                      operation: integer("operation").notNull(),
                      checkpoint: varchar("checkpoint", {
                        length: 75,
                      }).notNull(),
                    }),
                  );

                  await sql
                    .raw(
                      generateTableSQL({
                        table,
                        namespace,
                        extraColumns,
                        namePrefix: "_ponder_reorg__",
                      }),
                    )
                    .execute(tx);
                }
              }
            };

            const row = await tx
              .selectFrom("_ponder_meta")
              .where("key", "=", "app")
              .select("value")
              .executeTakeFirst();

            const previousApp: PonderApp | undefined =
              row === undefined
                ? undefined
                : dialect === "sqlite"
                  ? JSON.parse(row.value!)
                  : row.value;

            const newApp = {
              is_locked: 1,
              is_dev: args.common.options.command === "dev" ? 1 : 0,
              heartbeat_at: Date.now(),
              build_id: buildId,
              checkpoint: encodeCheckpoint(zeroCheckpoint),
              table_names: tableNames,
            } satisfies PonderApp;

            /**
             * If schema is empty, start
             */
            if (previousApp === undefined) {
              await tx
                .insertInto("_ponder_meta")
                .values({ key: "status", value: null })
                .onConflict((oc) =>
                  oc.column("key").doUpdateSet({ key: "status", value: null }),
                )
                .execute();
              await tx
                .insertInto("_ponder_meta")
                .values({ key: "app", value: encodeApp(newApp) })
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
              previousApp.is_dev === 0 &&
              previousApp.is_locked === 1 &&
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
                    is_locked: 1,
                    is_dev: 0,
                    heartbeat_at: Date.now(),
                  }),
                })
                .where("key", "=", "app")
                .execute();

              args.common.logger.info({
                service: "database",
                msg: `Detected cache hit for build '${buildId}' in schema '${namespace}' last active ${formatEta(Date.now() - previousApp.heartbeat_at)} ago`,
              });
              args.common.logger.debug({
                service: "database",
                msg: `Acquired lock on schema '${namespace}'`,
              });

              // Remove indexes
              // for (const [tableName, table] of Object.entries(
              //   getTables(args.schema),
              // )) {
              //   if (table.constraints === undefined) continue;

              //   for (const name of Object.keys(table.constraints)) {
              //     await tx.schema
              //       .dropIndex(`${tableName}_${name}`)
              //       .ifExists()
              //       .execute();

              //     args.common.logger.info({
              //       service: "database",
              //       msg: `Dropped index '${tableName}_${name}' in schema '${namespace}'`,
              //     });
              //   }
              // }

              // Remove triggers

              const tableNames = Object.values(args.schema)
                .filter((table): table is PgTable => is(table, PgTable))
                .map((table) => getTableConfig(table).name);

              for (const tableName of tableNames) {
                await sql
                  .ref(
                    `DROP TRIGGER IF EXISTS ${tableName}_reorg ON "${namespace}"."${tableName}"`,
                  )
                  .execute(tx);
              }

              // Revert unfinalized data

              const { blockTimestamp, chainId, blockNumber } = decodeCheckpoint(
                previousApp.checkpoint,
              );
              args.common.logger.info({
                service: "database",
                msg: `Reverting operations after finalized checkpoint (timestamp=${blockTimestamp} chainId=${chainId} block=${blockNumber})`,
              });

              for (const tableName of tableNames) {
                await revert({
                  tableName,
                  checkpoint: previousApp.checkpoint,
                  tx,
                });
              }

              return {
                status: "success",
                checkpoint: previousApp.checkpoint,
              } as const;
            }

            /**
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

            for (const tableName of previousApp.table_names) {
              await tx.schema
                .dropTable(`_ponder_reorg__${tableName}`)
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
          const heartbeat = Date.now();

          await qb.internal
            .updateTable("_ponder_meta")
            .where("key", "=", "app")
            .set({
              value:
                dialect === "sqlite"
                  ? sql`json_set(value, '$.heartbeat_at', ${heartbeat})`
                  : sql`jsonb_set(value, '{heartbeat_at}', ${heartbeat})`,
            })
            .execute();

          args.common.logger.debug({
            service: "database",
            msg: `Updated heartbeat timestamp to ${heartbeat} (build_id=${buildId})`,
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
    // async createIndexes() {
    //   await Promise.all(
    //     Object.entries(getTables(args.schema)).flatMap(([tableName, table]) => {
    //       if (table.constraints === undefined) return [];

    //       return Object.entries(table.constraints).map(
    //         async ([name, index]) => {
    //           await qb.internal.wrap({ method: "createIndexes" }, async () => {
    //             const indexName = `${tableName}_${name}`;

    //             const indexColumn = index[" column"];
    //             const order = index[" order"];
    //             const nulls = index[" nulls"];

    //             if (dialect === "sqlite") {
    //               const columns = Array.isArray(indexColumn)
    //                 ? indexColumn.map((ic) => `"${ic}"`).join(", ")
    //                 : `"${indexColumn}" ${order === "asc" ? "ASC" : order === "desc" ? "DESC" : ""}`;

    //               await qb.internal.executeQuery(
    //                 sql`CREATE INDEX ${sql.ref(indexName)} ON ${sql.table(
    //                   tableName,
    //                 )} (${sql.raw(columns)})`.compile(qb.internal),
    //               );
    //             } else {
    //               const columns = Array.isArray(indexColumn)
    //                 ? indexColumn.map((ic) => `"${ic}"`).join(", ")
    //                 : `"${indexColumn}" ${order === "asc" ? "ASC" : order === "desc" ? "DESC" : ""} ${
    //                     nulls === "first"
    //                       ? "NULLS FIRST"
    //                       : nulls === "last"
    //                         ? "NULLS LAST"
    //                         : ""
    //                   }`;

    //               await qb.internal.executeQuery(
    //                 sql`CREATE INDEX ${sql.ref(indexName)} ON ${sql.table(
    //                   `${namespace}.${tableName}`,
    //                 )} (${sql.raw(columns)})`.compile(qb.internal),
    //               );
    //             }
    //           });

    //           args.common.logger.info({
    //             service: "database",
    //             msg: `Created index '${tableName}_${name}' on columns (${
    //               Array.isArray(index[" column"])
    //                 ? index[" column"].join(", ")
    //                 : index[" column"]
    //             }) in schema '${namespace}'`,
    //           });
    //         },
    //       );
    //     }),
    //   );
    // },
    async createTriggers() {
      await qb.internal.wrap({ method: "createTriggers" }, async () => {
        const tableNames = Object.values(args.schema)
          .filter((table): table is PgTable => is(table, PgTable))
          .map((table) => getTableConfig(table).name);

        for (const tableName of tableNames) {
          const columns = getTableColumns(args.schema[tableName]! as PgTable);

          const columnNames = Object.values(columns).map(
            (column) => column.name,
          );

          await sql
            .raw(`
CREATE OR REPLACE FUNCTION ${tableName}_reorg_operation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "_ponder_reorg__${tableName}" (${columnNames.join(",")}, operation, checkpoint) 
    VALUES (${columnNames.map((name) => `NEW.${name}`).join(",")}, 0, '${encodeCheckpoint(maxCheckpoint)}');
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO "_ponder_reorg__${tableName}" (${columnNames.join(",")}, operation, checkpoint) 
    VALUES (${columnNames.map((name) => `OLD.${name}`).join(",")}, 1, '${encodeCheckpoint(maxCheckpoint)}');
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO "_ponder_reorg__${tableName}" (${columnNames.join(",")}, operation, checkpoint) 
    VALUES (${columnNames.map((name) => `OLD.${name}`).join(",")}, 2, '${encodeCheckpoint(maxCheckpoint)}');   
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql
        `)
            .execute(qb.internal);

          await sql
            .raw(`
CREATE TRIGGER "${tableName}_reorg"
AFTER INSERT OR UPDATE OR DELETE ON "${namespace}"."${tableName}"
FOR EACH ROW EXECUTE FUNCTION ${tableName}_reorg_operation();
  `)
            .execute(qb.internal);
        }
      });
    },
    async revert({ checkpoint }) {
      const tableNames = Object.values(args.schema)
        .filter((table): table is PgTable => is(table, PgTable))
        .map((table) => getTableConfig(table).name);
      await qb.internal.wrap({ method: "revert" }, () =>
        Promise.all(
          tableNames.map((tableName) =>
            qb.internal
              .transaction()
              .execute((tx) => revert({ tableName, checkpoint, tx })),
          ),
        ),
      );
    },
    async finalize({ checkpoint }) {
      await qb.internal.wrap({ method: "finalize" }, async () => {
        await qb.internal
          .updateTable("_ponder_meta")
          .where("key", "=", "app")
          .set({
            value:
              dialect === "sqlite"
                ? sql`json_set(value, '$.checkpoint', ${checkpoint})`
                : sql`jsonb_set(value, '{checkpoint}', to_jsonb(${checkpoint}::varchar(75)))`,
          })
          .execute();

        const tableNames = Object.values(args.schema)
          .filter((table): table is PgTable => is(table, PgTable))
          .map((table) => getTableConfig(table).name);

        await Promise.all(
          tableNames.map((tableName) =>
            qb.internal
              .deleteFrom(`_ponder_reorg__${tableName}`)
              .where("checkpoint", "<=", checkpoint)
              .execute(),
          ),
        );
      });

      const decoded = decodeCheckpoint(checkpoint);

      args.common.logger.debug({
        service: "database",
        msg: `Updated finalized checkpoint to (timestamp=${decoded.blockTimestamp} chainId=${decoded.chainId} block=${decoded.blockNumber})`,
      });
    },
    async complete({ checkpoint }) {
      const tableNames = Object.values(args.schema)
        .filter((table): table is PgTable => is(table, PgTable))
        .map((table) => getTableConfig(table).name);

      await Promise.all(
        tableNames.map((tableName) =>
          qb.internal.wrap({ method: "complete" }, async () => {
            await qb.internal
              .updateTable(`_ponder_reorg__${tableName}`)
              .set({ checkpoint })
              .where("checkpoint", "=", encodeCheckpoint(maxCheckpoint))
              .execute();
          }),
        ),
      );
    },
    async kill() {
      clearInterval(heartbeatInterval);

      await qb.internal
        .updateTable("_ponder_meta")
        .where("key", "=", "app")
        .set({
          value:
            dialect === "sqlite"
              ? sql`json_set(value, '$.is_locked', 0)`
              : sql`jsonb_set(value, '{is_locked}', to_jsonb(0))`,
        })
        .execute();

      args.common.logger.debug({
        service: "database",
        msg: `Released lock on schema '${namespace}'`,
      });

      await qb.internal.destroy();
      await qb.user.destroy();
      await qb.readonly.destroy();
      await qb.sync.destroy();

      if (dialect === "sqlite") {
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
