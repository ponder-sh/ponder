import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import type { DatabaseConfig } from "@/config/database.js";
import { type Drizzle, type Schema, onchain } from "@/drizzle/index.js";
import { generateTableSQL, getPrimaryKeyColumns } from "@/drizzle/sql.js";
import type { PonderSyncSchema } from "@/sync-store/encoding.js";
import {
  moveLegacyTables,
  migrationProvider as postgresMigrationProvider,
} from "@/sync-store/migrations.js";
import type { Status } from "@/sync/index.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { formatEta } from "@/utils/format.js";
import { createPool } from "@/utils/pg.js";
import { createPglite } from "@/utils/pglite.js";
import { wait } from "@/utils/wait.js";
import type { PGlite } from "@electric-sql/pglite";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import {
  PgTable,
  getTableConfig,
  integer,
  pgTable,
  serial,
  varchar,
} from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import {
  Migrator,
  PostgresDialect,
  type Transaction,
  WithSchemaPlugin,
  sql,
} from "kysely";
import { KyselyPGlite } from "kysely-pglite";
import type { Pool } from "pg";
import prometheus from "prom-client";
import { HeadlessKysely } from "./kysely.js";

export type Database<
  dialect extends "pglite" | "postgres" = "pglite" | "postgres",
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
    value: PonderApp | Status | null;
  };
} & {
  [_: `_ponder_reorg__${string}`]: {
    operation_id: number;
    checkpoint: string;
    operation: 0 | 1 | 2;
  };
};

type PGliteDriver = {
  instance: PGlite;
};

type PostgresDriver = {
  internal: Pool;
  user: Pool;
  readonly: Pool;
  sync: Pool;
};

type Driver<dialect extends "pglite" | "postgres"> = dialect extends "pglite"
  ? PGliteDriver
  : PostgresDriver;

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

  let driver: Database["driver"];
  let qb: Database["qb"];

  const dialect = args.databaseConfig.kind;

  if (args.databaseConfig.kind === "pglite") {
    namespace = "public";

    driver = {
      instance: createPglite(args.databaseConfig.options),
    };

    const kyselyDialect = new KyselyPGlite(driver.instance).dialect;

    qb = {
      internal: new HeadlessKysely({
        name: "internal",
        common: args.common,
        dialect: kyselyDialect,
        log(event) {
          if (event.level === "query") {
            args.common.metrics.ponder_postgres_query_total.inc({
              pool: "internal",
            });
          }
        },
      }),
      user: new HeadlessKysely({
        name: "user",
        common: args.common,
        dialect: kyselyDialect,
        log(event) {
          if (event.level === "query") {
            args.common.metrics.ponder_postgres_query_total.inc({
              pool: "user",
            });
          }
        },
      }),
      readonly: new HeadlessKysely({
        name: "readonly",
        common: args.common,
        dialect: kyselyDialect,
        log(event) {
          if (event.level === "query") {
            args.common.metrics.ponder_postgres_query_total.inc({
              pool: "readonly",
            });
          }
        },
      }),
      sync: new HeadlessKysely<PonderSyncSchema>({
        name: "sync",
        common: args.common,
        dialect: kyselyDialect,
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
  } else {
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

  const drizzle =
    dialect === "pglite"
      ? drizzlePglite((driver as PGliteDriver).instance, args.schema)
      : drizzleNodePg((driver as PostgresDriver).user, args.schema);

  // if (fs.existsSync(args.common.options.migrationsDir)) {
  //   await migrate(drizzle, {
  //     migrationsFolder: args.common.options.migrationsDir,
  //   });
  // }

  // Register metrics
  const d = driver as PostgresDriver;
  args.common.metrics.registry.removeSingleMetric(
    "ponder_postgres_pool_connections",
  );
  args.common.metrics.ponder_postgres_pool_connections = new prometheus.Gauge({
    name: "ponder_postgres_pool_connections",
    help: "Number of connections in the pool",
    labelNames: ["pool", "kind"] as const,
    registers: [args.common.metrics.registry],
    collect() {
      this.set({ pool: "internal", kind: "idle" }, d.internal.idleCount);
      this.set({ pool: "internal", kind: "total" }, d.internal.totalCount);
      this.set({ pool: "sync", kind: "idle" }, d.sync.idleCount);
      this.set({ pool: "sync", kind: "total" }, d.sync.totalCount);
      this.set({ pool: "user", kind: "idle" }, d.user.idleCount);
      this.set({ pool: "user", kind: "total" }, d.user.totalCount);
      this.set({ pool: "readonly", kind: "idle" }, d.readonly.idleCount);
      this.set({ pool: "readonly", kind: "total" }, d.readonly.totalCount);
    },
  });

  args.common.metrics.registry.removeSingleMetric(
    "ponder_postgres_query_queue_size",
  );
  args.common.metrics.ponder_postgres_query_queue_size = new prometheus.Gauge({
    name: "ponder_postgres_query_queue_size",
    help: "Number of query requests waiting for an available connection",
    labelNames: ["pool"] as const,
    registers: [args.common.metrics.registry],
    collect() {
      this.set({ pool: "internal" }, d.internal.waitingCount);
      this.set({ pool: "sync" }, d.sync.waitingCount);
      this.set({ pool: "user" }, d.user.waitingCount);
      this.set({ pool: "readonly" }, d.readonly.waitingCount);
    },
  });

  ////////
  // Helpers
  ////////

  /**
   * Undo operations in user tables by using the `_ponder_reorg` metadata.
   *
   * Note: `_ponder_reorg` tables may contain operations that have not been applied to the
   *       underlying tables, but only be 1 operation at most.
   */
  const revert = async ({
    sqlTableName,
    jsTableName,
    checkpoint,
    tx,
  }: {
    sqlTableName: string;
    jsTableName: string;
    checkpoint: string;
    tx: Transaction<PonderInternalSchema>;
  }) => {
    const primaryKeyColumns = getPrimaryKeyColumns(
      args.schema[jsTableName] as PgTable,
    );

    const rows = await tx
      .deleteFrom(`_ponder_reorg__${sqlTableName}`)
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
      msg: `Reverted ${rows.length} unfinalized operations from '${sqlTableName}' table`,
    });
  };

  const getJsTableNames = () => {
    const tableNames = Object.entries(args.schema)
      .filter(([, table]) => is(table, PgTable))
      .map(([tableName]) => tableName);

    return tableNames;
  };

  const getSQLTableNames = () => {
    const tableNames = Object.values(args.schema)
      .filter((table): table is PgTable => is(table, PgTable))
      .map((table) => getTableConfig(table).name);

    return tableNames;
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
        await moveLegacyTables({
          common: args.common,
          // @ts-expect-error
          db: qb.internal,
          newSchemaName: "ponder_sync",
        });

        const migrator = new Migrator({
          db: qb.sync as any,
          provider: postgresMigrationProvider,
          migrationTableSchema: "ponder_sync",
        });

        const { error } = await migrator.migrateToLatest();
        if (error) throw error;
      });
    },
    async setup({ buildId }) {
      ////////
      // Migrate
      ////////

      // v0.4 migration ???

      // v0.6 migration

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
              await qb.internal.schema.dropSchema("ponder").cascade().execute();

              args.common.logger.debug({
                service: "database",
                msg: `Removed 'ponder' schema`,
              });
            }
          }
        });
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

            const previousApp = (row?.value ?? undefined) as
              | PonderApp
              | undefined;

            const newApp = {
              is_locked: 1,
              is_dev: args.common.options.command === "dev" ? 1 : 0,
              heartbeat_at: Date.now(),
              build_id: buildId,
              checkpoint: encodeCheckpoint(zeroCheckpoint),
              table_names: getSQLTableNames(),
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
                .values({ key: "app", value: newApp })
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
                  value: {
                    ...previousApp,
                    is_locked: 1,
                    is_dev: 0,
                    heartbeat_at: Date.now(),
                  },
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

              const sqlTableNames = getSQLTableNames();
              const jsTableNames = getJsTableNames();

              for (const tableName of sqlTableNames) {
                await sql
                  .ref(
                    `DROP TRIGGER IF EXISTS "${tableName}_reorg" ON "${namespace}"."${tableName}"`,
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

              for (let i = 0; i < sqlTableNames.length; i++) {
                await revert({
                  sqlTableName: sqlTableNames[i]!,
                  jsTableName: jsTableNames[i]!,
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
              .set({ value: newApp })
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

              await tx.schema
                .dropTable(tableName)
                .ifExists()
                .cascade()
                .execute();

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
              value: sql`jsonb_set(value, '{heartbeat_at}', ${heartbeat})`,
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
        const sqlTableNames = getSQLTableNames();
        const jsTableNames = getJsTableNames();

        for (let i = 0; i < sqlTableNames.length; i++) {
          const jsTableName = jsTableNames[i]!;
          const sqlTableName = sqlTableNames[i]!;

          const columns = getTableColumns(args.schema[jsTableName]! as PgTable);

          const columnNames = Object.values(columns).map(
            (column) => `"${column.name}"`,
          );

          await sql
            .raw(`
CREATE OR REPLACE FUNCTION ${sqlTableName}_reorg_operation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "_ponder_reorg__${sqlTableName}" (${columnNames.join(",")}, operation, checkpoint) 
    VALUES (${columnNames.map((name) => `NEW.${name}`).join(",")}, 0, '${encodeCheckpoint(maxCheckpoint)}');
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO "_ponder_reorg__${sqlTableName}" (${columnNames.join(",")}, operation, checkpoint) 
    VALUES (${columnNames.map((name) => `OLD.${name}`).join(",")}, 1, '${encodeCheckpoint(maxCheckpoint)}');
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO "_ponder_reorg__${sqlTableName}" (${columnNames.join(",")}, operation, checkpoint) 
    VALUES (${columnNames.map((name) => `OLD.${name}`).join(",")}, 2, '${encodeCheckpoint(maxCheckpoint)}');   
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql
        `)
            .execute(qb.internal);

          await sql
            .raw(`
CREATE TRIGGER "${sqlTableName}_reorg"
AFTER INSERT OR UPDATE OR DELETE ON "${namespace}"."${sqlTableName}"
FOR EACH ROW EXECUTE FUNCTION ${sqlTableName}_reorg_operation();
  `)
            .execute(qb.internal);
        }
      });
    },
    async revert({ checkpoint }) {
      const sqlTableNames = getSQLTableNames();
      const jsTableNames = getJsTableNames();

      await qb.internal.wrap({ method: "revert" }, () =>
        Promise.all(
          sqlTableNames.map((sqlTableName, i) =>
            qb.internal.transaction().execute((tx) =>
              revert({
                sqlTableName,
                jsTableName: jsTableNames[i]!,
                checkpoint,
                tx,
              }),
            ),
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
            value: sql`jsonb_set(value, '{checkpoint}', to_jsonb(${checkpoint}::varchar(75)))`,
          })
          .execute();

        const tableNames = getSQLTableNames();

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
      const tableNames = getSQLTableNames();

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
          value: sql`jsonb_set(value, '{is_locked}', to_jsonb(0))`,
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

      if (dialect === "pglite") {
        const d = driver as PGliteDriver;
        await d.instance.close();
      }

      if (dialect === "postgres") {
        const d = driver as PostgresDriver;
        await d.internal.end();
        await d.user.end();
        await d.readonly.end();
        await d.sync.end();
      }

      args.common.logger.debug({
        service: "database",
        msg: "Closed connection to database",
      });
    },
  };
};
