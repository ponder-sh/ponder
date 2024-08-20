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
import type { UserTable } from "@/types/schema.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { formatEta } from "@/utils/format.js";
import {
  type SqliteDatabase,
  createSqliteDatabase as _createSqliteDatabase,
  createReadonlySqliteDatabase,
} from "@/utils/sqlite.js";
import { wait } from "@/utils/wait.js";
import { sql as ksql } from "kysely";
import { SqliteDialect } from "kysely";
import prometheus from "prom-client";
import { HeadlessKysely } from "./kysely.js";
import { revertIndexingTables } from "./revert.js";

export type Database = {
  sql: "sqlite" | "postgres";
  namespace: string;
  driver: Driver;
  orm: ORM;
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

type Driver = {
  user: SqliteDatabase;
  readonly: SqliteDatabase;
  sync: SqliteDatabase;
};

type ORM = {
  internal: HeadlessKysely<PonderInternalSchema>;
  user: HeadlessKysely<unknown>;
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

export const createSqliteDatabase = (args: {
  common: Common;
  schema: Schema;
  databaseConfig: Extract<DatabaseConfig, { kind: "sqlite" }>;
}): Database => {
  let heartbeatInterval: NodeJS.Timeout | undefined;
  const namespace = "public";

  ////////
  // Create drivers
  ////////

  const userFile = path.join(args.databaseConfig.directory, "public.db");
  const syncFile = path.join(args.databaseConfig.directory, "ponder_sync.db");

  const driver = {
    user: _createSqliteDatabase(userFile),
    readonly: createReadonlySqliteDatabase(userFile),
    sync: _createSqliteDatabase(syncFile),
  } satisfies Driver;

  driver.user.exec(`ATTACH DATABASE '${userFile}' AS public`);
  driver.readonly.exec(`ATTACH DATABASE '${userFile}' AS public`);

  ////////
  // Create orms
  ////////

  // TODO(kyle) preset schema?

  const orm = {
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
  } satisfies ORM;

  args.common.metrics.registry.removeSingleMetric("ponder_sqlite_query_total");
  args.common.metrics.ponder_sqlite_query_total = new prometheus.Counter({
    name: "ponder_sqlite_query_total",
    help: "Number of queries submitted to the database",
    labelNames: ["database"] as const,
    registers: [args.common.metrics.registry],
  });

  return {
    sql: "sqlite",
    namespace,
    driver,
    orm,
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
                          scalarToSqliteType[column[" scalar"]],
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
                      `Unable to create table '${tableName}' in 'public.db' because a table with that name already exists. Is there another application using the 'public.db' database file?`,
                    );
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
                          scalarToSqliteType[column[" scalar"]],
                          (col) => {
                            if (columnName === "id") col = col.notNull();
                            return col;
                          },
                        );
                      }
                    }

                    return builder;
                  })
                  .execute();
              }
            };

            const previousApp = await tx
              .selectFrom("_ponder_meta")
              .where("key", "=", "app")
              .select("value")
              .executeTakeFirst()
              .then((app) =>
                app ? (JSON.parse(app.value!) as PonderApp) : undefined,
              );

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
                  { key: "app", value: JSON.stringify(newApp) },
                ])
                .execute();
              args.common.logger.debug({
                service: "database",
                msg: `Acquired lock on database file 'public.db'`,
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
                  value: JSON.stringify({
                    is_locked: true,
                    is_dev: false,
                    heartbeat_at: Date.now(),
                    checkpoint: previousApp.checkpoint,
                    build_id: previousApp.build_id,
                    schema: previousApp.schema,
                  }),
                })
                .where("key", "=", "app")
                .execute();

              args.common.logger.info({
                service: "database",
                msg: `Detected cache hit for build '${buildId}' in database file 'ponder.db' last active ${formatEta(Date.now() - previousApp.heartbeat_at)} ago`,
              });
              args.common.logger.debug({
                service: "database",
                msg: `Acquired lock on schema 'public'`,
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
                    msg: `Dropped index '${tableName}_${name}' in schema 'public'`,
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
              .set({ value: JSON.stringify(newApp) })
              .where("key", "=", "app")
              .execute();

            args.common.logger.debug({
              service: "database",
              msg: `Acquired lock on schema 'public' previously used by build '${previousApp.build_id}'`,
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
          msg: `Database file 'public.db' is locked by a different Ponder app`,
        });
        args.common.logger.warn({
          service: "database",
          msg: `Waiting ${formatEta(duration)} for lock on database file 'public.db' to expire...`,
        });

        await wait(duration);

        result = await attempt();
        if (result.status === "locked") {
          throw new NonRetryableError(
            `Failed to acquire lock on database file 'public.db'. A different Ponder app is actively using this database.`,
          );
        }
      }

      heartbeatInterval = setInterval(async () => {
        try {
          const row = await orm.internal
            .selectFrom("_ponder_meta")
            .where("key", "=", "app")
            .select("value")
            .executeTakeFirst();
          await orm.internal
            .updateTable("_ponder_meta")
            .where("key", "=", "app")
            .set({
              value: JSON.stringify({
                ...(JSON.parse(row!.value!) as PonderApp),
                heartbeat_at: Date.now(),
              }),
            })
            .execute();

          args.common.logger.debug({
            service: "database",
            msg: `Updated heartbeat timestamp to ${JSON.parse(row!.value!).heartbeat_at} (build_id=${buildId})`,
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

                const columns = Array.isArray(indexColumn)
                  ? indexColumn.map((ic) => `"${ic}"`).join(", ")
                  : `"${indexColumn}" ${order === "asc" ? "ASC" : order === "desc" ? "DESC" : ""}`;

                await orm.internal.executeQuery(
                  ksql`CREATE INDEX ${ksql.ref("public")}.${ksql.ref(indexName)} ON ${ksql.table(
                    tableName,
                  )} (${ksql.raw(columns)})`.compile(orm.internal),
                );
              });

              args.common.logger.info({
                service: "database",
                msg: `Created index '${tableName}_${name}' on columns (${
                  Array.isArray(index[" column"])
                    ? index[" column"].join(", ")
                    : index[" column"]
                }) in 'public.db'`,
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
        namespace: "public",
      });
    },
    async updateFinalizedCheckpoint({ checkpoint }) {
      await orm.internal.wrap(
        { method: "updateFinalizedCheckpoint" },
        async () => {
          const row = await orm.internal
            .selectFrom("_ponder_meta")
            .where("key", "=", "app")
            .select("value")
            .executeTakeFirst();
          await orm.internal
            .updateTable("_ponder_meta")
            .where("key", "=", "app")
            .set({
              value: JSON.stringify({
                ...(JSON.parse(row!.value!) as PonderApp),
                checkpoint,
              }),
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

      const row = await orm.internal
        .selectFrom("_ponder_meta")
        .where("key", "=", "app")
        .select("value")
        .executeTakeFirst();
      if (row) {
        await orm.internal
          .updateTable("_ponder_meta")
          .where("key", "=", "app")
          .set({
            value: JSON.stringify({
              ...(JSON.parse(row!.value!) as PonderApp),
              is_locked: false,
            }),
          })
          .execute();
      }
      args.common.logger.debug({
        service: "database",
        msg: `Released lock on namespace 'public'`,
      });

      await this.orm.internal.destroy();
      await this.orm.user.destroy();
      await this.orm.readonly.destroy();
      await this.orm.sync.destroy();

      this.driver.user.close();
      this.driver.readonly.close();
      this.driver.sync.close();

      args.common.logger.debug({
        service: "database",
        msg: "Closed connection to database",
      });
    },
  };
};
