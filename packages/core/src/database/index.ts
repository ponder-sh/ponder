import * as path from "node:path";
import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import type { DatabaseConfig } from "@/config/database.js";
import type { Schema } from "@/schema/common.js";
import {
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
import {
  moveLegacyTables,
  migrationProvider as postgresMigrationProvider,
} from "@/sync-store/migrations.js";
import type { Status } from "@/sync/index.js";
import type { UserTable } from "@/types/schema.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { formatEta } from "@/utils/format.js";
import { createPool, createReadonlyPool } from "@/utils/pg.js";
import { wait } from "@/utils/wait.js";
import { PGlite } from "@electric-sql/pglite";
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
  revert(args: { checkpoint: string }): Promise<void>;
  finalize(args: { checkpoint: string }): Promise<void>;
  createIndexes(args: { schema: Schema }): Promise<void>;
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
    id: unknown;
    operation_id: number;
    checkpoint: string;
    operation: 0 | 1 | 2;
  };
} & {
  [tableName: string]: UserTable;
};

type PGliteDriver = {
  user: PGlite;
  sync: PGlite;
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

const scalarToPostgresType = {
  boolean: "integer",
  int: "integer",
  float: "float8",
  string: "text",
  bigint: "numeric(78, 0)",
  hex: "bytea",
} as const;

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

  if (args.databaseConfig.kind === "pglite") {
    dialect = "pglite";
    namespace = "public";

    const userDir = path.join(args.databaseConfig.directory, "public");
    const syncDir = path.join(args.databaseConfig.directory, "sync");

    const [userPglite, syncPglite] = await Promise.all([
      PGlite.create({ dataDir: userDir }),
      PGlite.create({ dataDir: syncDir }),
    ]);

    const userDialect = new KyselyPGlite(userPglite).dialect;
    const syncDialect = new KyselyPGlite(syncPglite).dialect;

    driver = {
      user: userPglite,
      sync: syncPglite,
    };

    qb = {
      internal: new HeadlessKysely({
        name: "internal",
        common: args.common,
        dialect: userDialect,
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
        dialect: userDialect,
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
        dialect: userDialect,
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
        dialect: syncDialect,
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

    // Register pool metrics
    const d = driver as PostgresDriver;
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
          this.set({ pool: "internal", kind: "idle" }, d.internal.idleCount);
          this.set({ pool: "internal", kind: "total" }, d.internal.totalCount);
          this.set({ pool: "sync", kind: "idle" }, d.sync.idleCount);
          this.set({ pool: "sync", kind: "total" }, d.sync.totalCount);
          this.set({ pool: "user", kind: "idle" }, d.user.idleCount);
          this.set({ pool: "user", kind: "total" }, d.user.totalCount);
          this.set({ pool: "readonly", kind: "idle" }, d.readonly.idleCount);
          this.set({ pool: "readonly", kind: "total" }, d.readonly.totalCount);
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
          this.set({ pool: "internal" }, d.internal.waitingCount);
          this.set({ pool: "sync" }, d.sync.waitingCount);
          this.set({ pool: "user" }, d.user.waitingCount);
          this.set({ pool: "readonly" }, d.readonly.waitingCount);
        },
      },
    );
  }

  ////////
  // Helpers
  ////////

  const revert = async ({
    tableName,
    checkpoint,
    tx,
  }: {
    tableName: string;
    checkpoint: string;
    tx: Transaction<PonderInternalSchema>;
  }) => {
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
      msg: `Reverted ${rows.length} unfinalized operations from '${tableName}' table`,
    });
  };

  return {
    dialect,
    namespace,
    driver,
    qb,
    async migrateSync() {
      await qb.sync.wrap({ method: "migrateSyncStore" }, async () => {
        // TODO: Probably remove this at 1.0 to speed up startup time.
        // TODO(kevin) is the `WithSchemaPlugin` going to break this?
        await moveLegacyTables({
          common: args.common,
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
        .selectFrom("information_schema.schemata")
        .select("schema_name")
        .where("schema_name", "=", "ponder")
        .executeTakeFirst()
        .then((schema) => schema?.schema_name === "ponder");

      if (hasPonderSchema) {
        await qb.internal.wrap({ method: "setup" }, async () => {
          const namespaceCount = await qb.internal
            .withSchema("ponder")
            .selectFrom("namespace_lock")
            .select(sql`count(*)`.as("count"))
            .executeTakeFirst();

          const tableNames = await qb.internal
            .withSchema("ponder")
            .selectFrom("namespace_lock")
            .select("schema")
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
              .deleteFrom("namespace_lock")
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
        await qb.internal.schema
          .createSchema(namespace)
          .ifNotExists()
          .execute();

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
                                sql`${sql.ref(columnName)} in (${sql.join(
                                  getEnums(args.schema)[column[" enum"]]!.map(
                                    (v) => sql.lit(v),
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
                          scalarToPostgresType[column[" scalar"]],
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
                      `Unable to create table '${namespace}'.'${tableName}' because a table with that name already exists. Is there another application using the '${namespace}' database schema?`,
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
                  .createTable(`_ponder_reorg__${tableName}`)
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
                          scalarToPostgresType[column[" scalar"]],
                          (col) => {
                            if (columnName === "id") col = col.notNull();
                            return col;
                          },
                        );
                      }
                    }

                    builder = builder
                      .addColumn("operation_id", "serial", (col) =>
                        col.notNull().primaryKey(),
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

            const row = await tx
              .selectFrom("_ponder_meta")
              .where("key", "=", "app")
              .select("value")
              .executeTakeFirst();

            const previousApp: PonderApp | null =
              (row?.value as PonderApp) ?? null;

            const newApp = {
              is_locked: 1,
              is_dev: args.common.options.command === "dev" ? 1 : 0,
              heartbeat_at: Date.now(),
              build_id: buildId,
              checkpoint: encodeCheckpoint(zeroCheckpoint),
              table_names: Object.keys(getTables(args.schema)),
            } satisfies PonderApp;

            /**
             * If schema is empty, start
             */
            if (!previousApp) {
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
                msg: `Reverting operations after finalized checkpoint (timestamp=${blockTimestamp} chainId=${chainId} block=${blockNumber})`,
              });

              for (const tableName of Object.keys(getTables(args.schema))) {
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
              value: sql`jsonb_set(value, '{heartbeat_at}', ${heartbeat})`,
            })
            .execute();

          args.common.logger.debug({
            service: "database",
            msg: `Updated heartbeat timestamp to ${heartbeat} (build_id=${buildId})`,
          });
        } catch (err) {
          const error = err as Error;
          console.log(error);
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
              await qb.internal.wrap({ method: "createIndexes" }, async () => {
                const indexName = `${tableName}_${name}`;

                const indexColumn = index[" column"];
                const order = index[" order"];
                const nulls = index[" nulls"];

                const columns = Array.isArray(indexColumn)
                  ? indexColumn.map((ic) => `"${ic}"`).join(", ")
                  : `"${indexColumn}" ${order === "asc" ? "ASC" : order === "desc" ? "DESC" : ""} ${
                      nulls === "first"
                        ? "NULLS FIRST"
                        : nulls === "last"
                          ? "NULLS LAST"
                          : ""
                    }`;

                await qb.internal.executeQuery(
                  sql`CREATE INDEX ${sql.ref(indexName)} ON ${sql.table(
                    `${namespace}.${tableName}`,
                  )} (${sql.raw(columns)})`.compile(qb.internal),
                );
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
    async revert({ checkpoint }) {
      await qb.internal.wrap({ method: "revert" }, () =>
        Promise.all(
          Object.keys(getTables(args.schema)).map((tableName) =>
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
            value: sql`jsonb_set(value, '{checkpoint}', to_jsonb(${checkpoint}::varchar(75)))`,
          })
          .execute();

        await Promise.all(
          Object.keys(getTables(args.schema)).map((tableName) =>
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
        await d.user.close();
        await d.sync.close();
      } else {
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
