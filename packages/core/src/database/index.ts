import crypto from "node:crypto";
import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import type { DatabaseConfig } from "@/config/database.js";
import {
  type Drizzle,
  type Schema,
  getPrimaryKeyColumns,
  getTableNames,
  userToReorgTableName,
  userToSqlTableName,
} from "@/drizzle/index.js";
import { type SqlStatements, getColumnCasing } from "@/drizzle/kit/index.js";
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
import { getTableColumns } from "drizzle-orm";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { PgTable } from "drizzle-orm/pg-core";
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

export type Database = {
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
   * - If schema is empty or no matching build_id, start
   * - If matching build_id and unlocked, cache hit
   * - Else, start
   *
   * Separate from this main control flow, two other actions can happen:
   * - Tables corresponding to non-live apps will be dropped, with a 3 app buffer
   * - Apps run with "ponder dev" will publish view immediately
   *
   * @returns The progress checkpoint that that app should start from.
   */
  setup(): Promise<{
    checkpoint: string;
  }>;
  createLiveViews(): Promise<void>;
  createIndexes(): Promise<void>;
  createTriggers(): Promise<void>;
  removeTriggers(): Promise<void>;
  revert(args: { checkpoint: string }): Promise<void>;
  finalize(args: { checkpoint: string }): Promise<void>;
  complete(args: { checkpoint: string }): Promise<void>;
  unlock(): Promise<void>;
  kill(): Promise<void>;
};

export type PonderApp = {
  is_locked: 0 | 1;
  is_dev: 0 | 1;
  heartbeat_at: number;
  instance_id: string;
  build_id: string;
  checkpoint: string;
  table_names: string[];
};

type PonderInternalSchema = {
  _ponder_meta:
    | { key: `app_${string}`; value: PonderApp }
    | { key: `status_${string}`; value: Status | null }
    | { key: `live`; value: { instance_id: string } };
} & {
  [_: ReturnType<typeof getTableNames>[number]["sql"]]: unknown;
} & {
  [_: ReturnType<typeof getTableNames>[number]["reorg"]]: unknown & {
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

export const createDatabase = (args: {
  common: Common;
  schema: Schema;
  statements: SqlStatements;
  namespace: string;
  databaseConfig: DatabaseConfig;
  instanceId: string;
  buildId: string;
}): Database => {
  let heartbeatInterval: NodeJS.Timeout | undefined;

  ////////
  // Create drivers and orms
  ////////

  let driver: PGliteDriver | PostgresDriver;
  let qb: Database["qb"];

  const dialect = args.databaseConfig.kind;

  if (dialect === "pglite" || dialect === "pglite_test") {
    driver = {
      instance:
        dialect === "pglite"
          ? createPglite(args.databaseConfig.options)
          : args.databaseConfig.instance,
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
        plugins: [new WithSchemaPlugin(args.namespace)],
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
        plugins: [new WithSchemaPlugin(args.namespace)],
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
        plugins: [new WithSchemaPlugin(args.namespace)],
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
        application_name: `${args.namespace}_internal`,
        max: internalMax,
        statement_timeout: 10 * 60 * 1000, // 10 minutes to accommodate slow sync store migrations.
      }),
      user: createPool({
        ...args.databaseConfig.poolConfig,
        application_name: `${args.namespace}_user`,
        max: userMax,
      }),
      readonly: createPool({
        ...args.databaseConfig.poolConfig,
        application_name: `${args.namespace}_readonly`,
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
        plugins: [new WithSchemaPlugin(args.namespace)],
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
        plugins: [new WithSchemaPlugin(args.namespace)],
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
        plugins: [new WithSchemaPlugin(args.namespace)],
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

    // Register Postgres-only metrics
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
        help: "Number of queries waiting for an available connection",
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

  const drizzle =
    dialect === "pglite" || dialect === "pglite_test"
      ? drizzlePglite((driver as PGliteDriver).instance, {
          casing: "snake_case",
          schema: args.schema,
        })
      : drizzleNodePg((driver as PostgresDriver).user, {
          casing: "snake_case",
          schema: args.schema,
        });

  ////////
  // Helpers
  ////////

  /**
   * Undo operations in user tables by using the "reorg" tables.
   *
   * Note: "reorg" tables may contain operations that have not been applied to the
   *       underlying tables, but only be 1 operation at most.
   */
  const revert = async ({
    tableName,
    checkpoint,
    tx,
  }: {
    tableName: ReturnType<typeof getTableNames>[number];
    checkpoint: string;
    tx: Transaction<PonderInternalSchema>;
    instanceId: string;
  }) => {
    const primaryKeyColumns = getPrimaryKeyColumns(
      args.schema[tableName.js] as PgTable,
    );

    const rows = await tx
      .deleteFrom(tableName.reorg)
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
          .deleteFrom(tableName.sql)
          .$call((qb) => {
            for (const { sql } of primaryKeyColumns) {
              // @ts-ignore
              qb = qb.where(sql, "=", log[sql]);
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
          .updateTable(tableName.sql)
          .set(log as any)
          .$call((qb) => {
            for (const { sql } of primaryKeyColumns) {
              // @ts-ignore
              qb = qb.where(sql, "=", log[sql]);
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
          .insertInto(tableName.sql)
          .values(log as any)
          // @ts-ignore
          .onConflict((oc) =>
            oc
              .columns(primaryKeyColumns.map(({ sql }) => sql) as any)
              .doNothing(),
          )
          .execute();
      }
    }

    args.common.logger.info({
      service: "database",
      msg: `Reverted ${rows.length} unfinalized operations from '${tableName.user}' table`,
    });
  };

  const database = {
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
    async setup() {
      ////////
      // Migrate
      ////////

      // v0.4 migration

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
        const hasNamespaceLockTable = await qb.internal
          // @ts-ignore
          .selectFrom("information_schema.tables")
          // @ts-ignore
          .select(["table_name", "table_schema"])
          // @ts-ignore
          .where("table_name", "=", "namespace_lock")
          // @ts-ignore
          .where("table_schema", "=", "ponder")
          .executeTakeFirst()
          .then((table) => table !== undefined);

        if (hasNamespaceLockTable) {
          await qb.internal.wrap({ method: "migrate" }, async () => {
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
              .where("namespace", "=", args.namespace)
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
                .where("namespace", "=", args.namespace)
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

      // v0.7 migration

      const hasPonderMetaTable = await qb.internal
        // @ts-ignore
        .selectFrom("information_schema.tables")
        // @ts-ignore
        .select(["table_name", "table_schema"])
        // @ts-ignore
        .where("table_name", "=", "_ponder_meta")
        // @ts-ignore
        .where("table_schema", "=", args.namespace)
        .executeTakeFirst()
        .then((table) => table !== undefined);

      if (hasPonderMetaTable) {
        await qb.internal.wrap({ method: "migrate" }, () =>
          qb.internal.transaction().execute(async (tx) => {
            const previousApp: PonderApp | undefined = await tx
              .selectFrom("_ponder_meta")
              // @ts-ignore
              .where("key", "=", "app")
              .select("value")
              .executeTakeFirst()
              .then((row) =>
                row === undefined ? undefined : (row.value as PonderApp),
              );

            if (previousApp) {
              const instanceId = crypto.randomBytes(2).toString("hex");

              await tx
                .deleteFrom("_ponder_meta")
                // @ts-ignore
                .where("key", "=", "app")
                .execute();

              await tx
                .deleteFrom("_ponder_meta")
                // @ts-ignore
                .where("key", "=", "status")
                .execute();

              for (const tableName of previousApp.table_names) {
                await tx.schema
                  .alterTable(tableName)
                  .renameTo(userToSqlTableName(tableName, instanceId))
                  .execute();

                await tx.schema
                  .alterTable(`_ponder_reorg__${tableName}`)
                  .renameTo(userToReorgTableName(tableName, instanceId))
                  .execute();
              }

              await tx
                .insertInto("_ponder_meta")
                .values({
                  key: `app_${instanceId}`,
                  value: { ...previousApp, instance_id: instanceId },
                })
                .execute();

              args.common.logger.debug({
                service: "database",
                msg: "Migrated previous app to v0.7",
              });
            }
          }),
        );
      }

      await qb.internal.wrap({ method: "setup" }, async () => {
        for (const statement of args.statements.schema.sql) {
          await sql.raw(statement).execute(qb.internal);
        }

        // Create "_ponder_meta" table if it doesn't exist
        await qb.internal.schema
          .createTable("_ponder_meta")
          .addColumn("key", "text", (col) => col.primaryKey())
          .addColumn("value", "jsonb")
          .ifNotExists()
          .execute();
      });

      const attempt = async ({ isFirstAttempt }: { isFirstAttempt: boolean }) =>
        qb.internal.wrap({ method: "setup" }, () =>
          qb.internal.transaction().execute(async (tx) => {
            const previousApps: PonderApp[] = await tx
              .selectFrom("_ponder_meta")
              .where("key", "like", "app_%")
              .select("value")
              .execute()
              .then((rows) => rows.map(({ value }) => value as PonderApp));

            const previousAppsWithBuildId = previousApps.filter(
              (app) => app.build_id === args.buildId && app.is_dev === 0,
            );

            const newApp = {
              is_locked: 1,
              is_dev: args.common.options.command === "dev" ? 1 : 0,
              heartbeat_at: Date.now(),
              instance_id: args.instanceId,
              build_id: args.buildId,
              checkpoint: encodeCheckpoint(zeroCheckpoint),
              table_names: getTableNames(args.schema, args.instanceId).map(
                (tableName) => tableName.user,
              ),
            } satisfies PonderApp;

            /**
             * If schema is empty, start
             */
            if (previousAppsWithBuildId.length === 0) {
              await tx
                .insertInto("_ponder_meta")
                .values({ key: `status_${args.instanceId}`, value: null })
                .onConflict((oc) =>
                  oc
                    .column("key")
                    // @ts-ignore
                    .doUpdateSet({ value: null }),
                )
                .execute();
              await tx
                .insertInto("_ponder_meta")
                .values({
                  key: `app_${args.instanceId}`,
                  value: newApp,
                })
                .onConflict((oc) =>
                  oc
                    .column("key")
                    // @ts-ignore
                    .doUpdateSet({ value: newApp }),
                )
                .execute();

              for (const tableName of getTableNames(
                args.schema,
                newApp.instance_id,
              )) {
                await tx.schema
                  .dropTable(tableName.sql)
                  .cascade()
                  .ifExists()
                  .execute();
                await tx.schema
                  .dropTable(tableName.reorg)
                  .cascade()
                  .ifExists()
                  .execute();
              }

              for (let i = 0; i < args.statements.enums.sql.length; i++) {
                await sql
                  .raw(args.statements.enums.sql[i]!)
                  .execute(tx)
                  .catch((_error) => {
                    const error = _error as Error;
                    if (!error.message.includes("already exists")) throw error;
                    throw new NonRetryableError(
                      `Unable to create enum '${args.namespace}'.'${args.statements.enums.json[i]!.name}' because an enum with that name already exists.`,
                    );
                  });
              }
              for (let i = 0; i < args.statements.tables.sql.length; i++) {
                await sql
                  .raw(args.statements.tables.sql[i]!)
                  .execute(tx)
                  .catch((_error) => {
                    const error = _error as Error;
                    if (!error.message.includes("already exists")) throw error;
                    throw new NonRetryableError(
                      `Unable to create table '${args.namespace}'.'${args.statements.tables.json[i]!.tableName}' because a table with that name already exists.`,
                    );
                  });
              }
              args.common.logger.info({
                service: "database",
                msg: `Created tables [${newApp.table_names.join(", ")}]`,
              });

              return {
                status: "success",
                checkpoint: encodeCheckpoint(zeroCheckpoint),
              } as const;
            }

            // Find the newest, unlocked, non-dev app to recover from
            const crashRecoveryApp =
              previousAppsWithBuildId
                .filter(
                  (app) =>
                    app.is_locked === 0 ||
                    app.heartbeat_at +
                      args.common.options.databaseHeartbeatTimeout <=
                      Date.now(),
                )
                .sort((a, b) => (a.checkpoint > b.checkpoint ? -1 : 1))[0] ??
              undefined;

            if (
              crashRecoveryApp &&
              crashRecoveryApp.checkpoint > encodeCheckpoint(zeroCheckpoint) &&
              args.common.options.command !== "dev"
            ) {
              await tx
                .insertInto("_ponder_meta")
                .values({ key: `status_${args.instanceId}`, value: null })
                .execute();
              await tx
                .insertInto("_ponder_meta")
                .values({
                  key: `app_${args.instanceId}`,
                  value: {
                    ...newApp,
                    checkpoint: crashRecoveryApp.checkpoint,
                  },
                })
                .execute();

              args.common.logger.info({
                service: "database",
                msg: `Detected cache hit for build '${args.buildId}' in schema '${args.namespace}' last active ${formatEta(Date.now() - crashRecoveryApp.heartbeat_at)} ago`,
              });

              // Remove triggers

              for (const tableName of getTableNames(
                args.schema,
                crashRecoveryApp.instance_id,
              )) {
                await sql
                  .raw(
                    `DROP TRIGGER IF EXISTS "${tableName.trigger}" ON "${args.namespace}"."${tableName.sql}"`,
                  )
                  .execute(tx);
              }

              // Remove indexes

              for (const indexStatement of args.statements.indexes.json) {
                await tx.schema
                  .dropIndex(indexStatement.data.name)
                  .ifExists()
                  .execute();

                args.common.logger.info({
                  service: "database",
                  msg: `Dropped index '${indexStatement.data.name}' in schema '${args.namespace}'`,
                });
              }

              // Rename tables + reorg tables
              for (const tableName of crashRecoveryApp.table_names) {
                await tx.schema
                  .alterTable(
                    userToSqlTableName(tableName, crashRecoveryApp.instance_id),
                  )
                  .renameTo(userToSqlTableName(tableName, args.instanceId))
                  .execute();

                await tx.schema
                  .alterTable(
                    userToReorgTableName(
                      tableName,
                      crashRecoveryApp.instance_id,
                    ),
                  )
                  .renameTo(userToReorgTableName(tableName, args.instanceId))
                  .execute();
              }

              await tx
                .deleteFrom("_ponder_meta")
                .where("key", "=", `status_${crashRecoveryApp.instance_id}`)
                .execute();

              // Drop app
              await tx
                .deleteFrom("_ponder_meta")
                .where("key", "=", `app_${crashRecoveryApp.instance_id}`)
                .execute();

              // Revert unfinalized data

              const { blockTimestamp, chainId, blockNumber } = decodeCheckpoint(
                crashRecoveryApp.checkpoint,
              );

              args.common.logger.info({
                service: "database",
                msg: `Reverting operations after finalized checkpoint (timestamp=${blockTimestamp} chainId=${chainId} block=${blockNumber})`,
              });

              for (const tableName of getTableNames(
                args.schema,
                args.instanceId,
              )) {
                await revert({
                  tableName,
                  checkpoint: crashRecoveryApp.checkpoint,
                  tx,
                  instanceId: args.instanceId,
                });
              }

              return {
                status: "success",
                checkpoint: crashRecoveryApp.checkpoint,
              } as const;
            }

            const nextAvailableApp = previousAppsWithBuildId.sort((a, b) =>
              a.heartbeat_at < b.heartbeat_at ? -1 : 1,
            )[0]!;

            if (
              isFirstAttempt &&
              args.common.options.command !== "dev" &&
              (crashRecoveryApp === undefined ||
                crashRecoveryApp.is_locked === 1)
            ) {
              return {
                status: "locked",
                expiry:
                  nextAvailableApp.heartbeat_at +
                  args.common.options.databaseHeartbeatTimeout,
              } as const;
            }

            /**
             * At this point in the control flow, there is an app with the same build_id,
             * but it can't be used as a crash recovery. The new app should startup.
             */

            await tx
              .insertInto("_ponder_meta")
              .values({ key: `status_${args.instanceId}`, value: null })
              // @ts-ignore
              .onConflict((oc) => oc.column("key").doUpdateSet({ value: null }))
              .execute();
            await tx
              .insertInto("_ponder_meta")
              .values({
                key: `app_${args.instanceId}`,
                value: newApp,
              })
              .onConflict((oc) =>
                oc
                  .column("key")
                  // @ts-ignore
                  .doUpdateSet({ value: newApp }),
              )
              .execute();

            // drop tables in case of non-unique instance_id

            for (const tableName of getTableNames(
              args.schema,
              newApp.instance_id,
            )) {
              await tx.schema
                .dropTable(tableName.sql)
                .cascade()
                .ifExists()
                .execute();
              await tx.schema
                .dropTable(tableName.reorg)
                .cascade()
                .ifExists()
                .execute();
            }

            for (let i = 0; i < args.statements.enums.sql.length; i++) {
              await sql
                .raw(args.statements.enums.sql[i]!)
                .execute(tx)
                .catch((_error) => {
                  const error = _error as Error;
                  if (!error.message.includes("already exists")) throw error;
                  throw new NonRetryableError(
                    `Unable to create enum '${args.namespace}'.'${args.statements.enums.json[i]!.name}' because an enum with that name already exists.`,
                  );
                });
            }
            for (let i = 0; i < args.statements.tables.sql.length; i++) {
              await sql
                .raw(args.statements.tables.sql[i]!)
                .execute(tx)
                .catch((_error) => {
                  const error = _error as Error;
                  if (!error.message.includes("already exists")) throw error;
                  throw new NonRetryableError(
                    `Unable to create table '${args.namespace}'.'${args.statements.tables.json[i]!.tableName}' because a table with that name already exists.`,
                  );
                });
            }
            args.common.logger.info({
              service: "database",
              msg: `Created tables [${newApp.table_names.join(", ")}]`,
            });

            return {
              status: "success",
              checkpoint: encodeCheckpoint(zeroCheckpoint),
            } as const;
          }),
        );

      let result = await attempt({ isFirstAttempt: true });
      if (result.status === "locked") {
        const duration = result.expiry - Date.now();
        args.common.logger.warn({
          service: "database",
          msg: `Schema '${args.namespace}' is locked by a different Ponder app`,
        });
        args.common.logger.warn({
          service: "database",
          msg: `Waiting ${formatEta(duration)} for lock on schema '${args.namespace} to expire...`,
        });

        await wait(duration);

        result = await attempt({ isFirstAttempt: false });
        if (result.status === "locked") {
          throw new NonRetryableError(
            `Failed to acquire lock on schema '${args.namespace}'. A different Ponder app is actively using this database.`,
          );
        }
      }

      if (process.env.PONDER_EXPERIMENTAL_DB !== "platform") {
        const apps: PonderApp[] = await qb.internal
          .selectFrom("_ponder_meta")
          .where("key", "like", "app_%")
          .select("value")
          .execute()
          .then((rows) => rows.map(({ value }) => value as PonderApp));

        const removedDevApps = apps.filter(
          (app) =>
            app.is_dev === 1 &&
            (app.is_locked === 0 ||
              app.heartbeat_at + args.common.options.databaseHeartbeatTimeout <
                Date.now()),
        );

        const removedStartApps = apps
          .filter(
            (app) =>
              app.is_dev === 0 &&
              (app.is_locked === 0 ||
                app.heartbeat_at +
                  args.common.options.databaseHeartbeatTimeout <
                  Date.now()),
          )
          .sort((a, b) => (a.heartbeat_at > b.heartbeat_at ? -1 : 1))
          .slice(2);

        const removedApps = [...removedDevApps, ...removedStartApps];

        for (const app of removedApps) {
          for (const table of app.table_names) {
            await qb.internal.schema
              .dropTable(userToSqlTableName(table, app.instance_id))
              .cascade()
              .ifExists()
              .execute();
            await qb.internal.schema
              .dropTable(userToReorgTableName(table, app.instance_id))
              .cascade()
              .ifExists()
              .execute();
          }
          await qb.internal
            .deleteFrom("_ponder_meta")
            .where("key", "=", `status_${app.instance_id}`)
            .execute();
          await qb.internal
            .deleteFrom("_ponder_meta")
            .where("key", "=", `app_${app.instance_id}`)
            .execute();
        }

        if (removedApps.length > 0) {
          args.common.logger.debug({
            service: "database",
            msg: `Removed tables corresponding to apps [${removedApps.map((app) => app.instance_id)}]`,
          });
        }

        if (apps.length === 1 || args.common.options.command === "dev") {
          await this.createLiveViews();
        }
      }

      heartbeatInterval = setInterval(async () => {
        try {
          const heartbeat = Date.now();

          await qb.internal
            .updateTable("_ponder_meta")
            .where("key", "=", `app_${args.instanceId}`)
            .set({
              value: sql`jsonb_set(value, '{heartbeat_at}', ${heartbeat})`,
            })
            .execute();

          args.common.logger.debug({
            service: "database",
            msg: `Updated heartbeat timestamp to ${heartbeat} (build_id=${args.buildId})`,
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
      for (const statement of args.statements.indexes.sql) {
        await sql.raw(statement).execute(qb.internal);
      }
    },
    async createLiveViews() {
      if (process.env.PONDER_EXPERIMENTAL_DB === "platform") return;

      await qb.internal.wrap({ method: "createLiveViews" }, async () => {
        // drop old views

        const previousLiveInstanceId: string | undefined = await qb.internal
          .selectFrom("_ponder_meta")
          .select("value")
          .where("key", "=", "live")
          .executeTakeFirst()
          .then((row) => (row?.value?.instance_id as string) ?? undefined);

        if (previousLiveInstanceId) {
          const previousTableNames = await qb.internal
            .selectFrom("_ponder_meta")
            .select("value")
            .where("key", "=", `app_${previousLiveInstanceId}`)
            .executeTakeFirst()
            .then((row) => (row ? (row.value as PonderApp).table_names : []));

          await Promise.all(
            previousTableNames.map((name) =>
              qb.internal.schema.dropView(name).ifExists().execute(),
            ),
          );
        }

        // update live app

        await qb.internal
          .insertInto("_ponder_meta")
          .values({
            key: "live",
            value: { instance_id: args.instanceId },
          })
          .onConflict((oc) =>
            oc
              .column("key")
              // @ts-ignore
              .doUpdateSet({ value: { instance_id: args.instanceId } }),
          )
          .execute();

        // create new views

        for (const tableName of getTableNames(args.schema, args.instanceId)) {
          await qb.internal.schema
            .createView(tableName.user)
            .orReplace()
            .as(qb.internal.selectFrom(tableName.sql).selectAll())
            .execute();

          args.common.logger.info({
            service: "database",
            msg: `Created view '${args.namespace}'.'${tableName.user}'`,
          });
        }
      });
    },
    async createTriggers() {
      await qb.internal.wrap({ method: "createTriggers" }, async () => {
        for (const tableName of getTableNames(args.schema, args.instanceId)) {
          const columns = getTableColumns(
            args.schema[tableName.js]! as PgTable,
          );

          const columnNames = Object.values(columns).map(
            (column) => `"${getColumnCasing(column, "snake_case")}"`,
          );

          await sql
            .raw(`
CREATE OR REPLACE FUNCTION ${tableName.triggerFn}
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "${args.namespace}"."${tableName.reorg}" (${columnNames.join(",")}, operation, checkpoint)
    VALUES (${columnNames.map((name) => `NEW.${name}`).join(",")}, 0, '${encodeCheckpoint(maxCheckpoint)}');
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO "${args.namespace}"."${tableName.reorg}" (${columnNames.join(",")}, operation, checkpoint)
    VALUES (${columnNames.map((name) => `OLD.${name}`).join(",")}, 1, '${encodeCheckpoint(maxCheckpoint)}');
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO "${args.namespace}"."${tableName.reorg}" (${columnNames.join(",")}, operation, checkpoint)
    VALUES (${columnNames.map((name) => `OLD.${name}`).join(",")}, 2, '${encodeCheckpoint(maxCheckpoint)}');
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql
`)
            .execute(qb.internal);

          await sql
            .raw(`
          CREATE TRIGGER "${tableName.trigger}"
          AFTER INSERT OR UPDATE OR DELETE ON "${args.namespace}"."${tableName.sql}"
          FOR EACH ROW EXECUTE FUNCTION ${tableName.triggerFn};
          `)
            .execute(qb.internal);
        }
      });
    },
    async removeTriggers() {
      await qb.internal.wrap({ method: "removeTriggers" }, async () => {
        for (const tableName of getTableNames(args.schema, args.instanceId)) {
          await sql
            .raw(
              `DROP TRIGGER IF EXISTS "${tableName.trigger}" ON "${args.namespace}"."${tableName.sql}"`,
            )
            .execute(qb.internal);
        }
      });
    },
    async revert({ checkpoint }) {
      await qb.internal.wrap({ method: "revert" }, () =>
        Promise.all(
          getTableNames(args.schema, args.instanceId).map((tableName) =>
            qb.internal.transaction().execute((tx) =>
              revert({
                tableName,
                checkpoint,
                tx,
                instanceId: args.instanceId,
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
          .where("key", "=", `app_${args.instanceId}`)
          .set({
            value: sql`jsonb_set(value, '{checkpoint}', to_jsonb(${checkpoint}::varchar(75)))`,
          })
          .execute();

        await Promise.all(
          getTableNames(args.schema, args.instanceId).map((tableName) =>
            qb.internal
              .deleteFrom(tableName.reorg)
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
      await Promise.all(
        getTableNames(args.schema, args.instanceId).map((tableName) =>
          qb.internal.wrap({ method: "complete" }, async () => {
            await qb.internal
              .updateTable(tableName.reorg)
              .set({ checkpoint })
              .where("checkpoint", "=", encodeCheckpoint(maxCheckpoint))
              .execute();
          }),
        ),
      );
    },
    async unlock() {
      clearInterval(heartbeatInterval);

      await qb.internal.wrap({ method: "unlock" }, async () => {
        await qb.internal
          .updateTable("_ponder_meta")
          .where("key", "=", `app_${args.instanceId}`)
          .set({
            value: sql`jsonb_set(value, '{is_locked}', to_jsonb(0))`,
          })
          .execute();
      });
    },
    async kill() {
      await qb.internal.destroy();
      await qb.user.destroy();
      await qb.readonly.destroy();
      await qb.sync.destroy();

      if (dialect === "pglite") {
        const d = driver as PGliteDriver;
        await d.instance.close();
      }

      if (dialect === "pglite_test") {
        // no-op, allow test harness to clean up the instance
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
  } satisfies Database;

  return database;
};
