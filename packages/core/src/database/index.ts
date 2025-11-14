import { getPartitionName, getReorgTableName } from "@/drizzle/index.js";
import {
  SHARED_OPERATION_ID_SEQUENCE,
  sqlToReorgTableName,
} from "@/drizzle/kit/index.js";
import {
  getLiveQueryNotifyProcedureName,
  getLiveQueryProcedureName,
} from "@/drizzle/onchain.js";
import type { Common } from "@/internal/common.js";
import {
  MigrationError,
  NonRetryableUserError,
  ShutdownError,
} from "@/internal/errors.js";
import type {
  CrashRecoveryCheckpoint,
  IndexingBuild,
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
} from "@/internal/types.js";
import { buildMigrationProvider } from "@/sync-store/migrations.js";
import * as PONDER_SYNC from "@/sync-store/schema.js";
import { decodeCheckpoint } from "@/utils/checkpoint.js";
import { formatEta } from "@/utils/format.js";
import { createPool, createReadonlyPool } from "@/utils/pg.js";
import { createPglite, createPgliteKyselyDialect } from "@/utils/pglite.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import type { PGlite } from "@electric-sql/pglite";
import {
  eq,
  getTableName,
  getViewName,
  isTable,
  isView,
  sql,
} from "drizzle-orm";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { pgSchema, pgTable } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Kysely, Migrator, PostgresDialect, WithSchemaPlugin } from "kysely";
import type { Pool } from "pg";
import prometheus from "prom-client";
import { hexToBigInt } from "viem";
import {
  crashRecovery,
  createLiveQueryProcedures,
  dropLiveQueryTriggers,
  dropTriggers,
} from "./actions.js";
import { type QB, createQB, parseDbError } from "./queryBuilder.js";

export type Database = {
  driver: PostgresDriver | PGliteDriver;
  syncQB: QB<typeof PONDER_SYNC>;
  adminQB: QB;
  userQB: QB;
  readonlyQB: QB;
  /** Migrate the `ponder_sync` schema. */
  migrateSync(): Promise<void>;
  /**
   * Migrate the user schema.
   *
   * @returns The crash recovery checkpoint for each chain if there is a cache hit, else undefined.
   */
  migrate({
    buildId,
    chains,
    finalizedBlocks,
  }: Pick<
    IndexingBuild,
    "buildId" | "chains" | "finalizedBlocks"
  >): Promise<CrashRecoveryCheckpoint>;
};

export const SCHEMATA = pgSchema("information_schema").table(
  "schemata",
  (t) => ({
    schemaName: t.text().primaryKey(),
  }),
);

export const TABLES = pgSchema("information_schema").table("tables", (t) => ({
  table_name: t.text().notNull(),
  table_schema: t.text().notNull(),
  table_type: t.text().notNull(),
}));

export const VIEWS = pgSchema("information_schema").table("views", (t) => ({
  table_name: t.text().notNull(),
  table_schema: t.text().notNull(),
}));

// Note: "version" was introduced in 0.9

export type PonderApp0 = {
  version: undefined;
  is_locked: 0 | 1;
  is_dev: 0 | 1;
  heartbeat_at: number;
  build_id: string;
  checkpoint: string;
  table_names: string[];
};

export type PonderApp1 = {
  version: "1";
  build_id: string;
  table_names: string[];
  is_locked: 0 | 1;
  is_ready: 0 | 1;
  heartbeat_at: number;
};
export type PonderApp2 = Omit<PonderApp1, "version"> & {
  version: "2";
  is_dev: 0 | 1;
};

export type PonderApp3 = Omit<PonderApp2, "version"> & {
  version: "3";
};
export type PonderApp4 = Omit<PonderApp3, "version"> & {
  version: "4";
};
export type PonderApp5 = Omit<PonderApp4, "version"> & {
  version: "5";
  view_names: string[];
};

const VERSION = "5";

type PGliteDriver = {
  dialect: "pglite";
  instance: PGlite;
};

type PostgresDriver = {
  dialect: "postgres";
  admin: Pool;
  sync: Pool;
  user: Pool;
  readonly: Pool;
};

export const getPonderMetaTable = (schema?: string) => {
  if (schema === undefined || schema === "public") {
    return pgTable("_ponder_meta", (t) => ({
      key: t.text().primaryKey().$type<"app">(),
      value: t.jsonb().$type<PonderApp5>().notNull(),
    }));
  }

  return pgSchema(schema).table("_ponder_meta", (t) => ({
    key: t.text().primaryKey().$type<"app">(),
    value: t.jsonb().$type<PonderApp5>().notNull(),
  }));
};

/**
 * @dev It is an invariant that `latestCheckpoint` refers to the same chain as `chainId`.
 */
export const getPonderCheckpointTable = (schema?: string) => {
  if (schema === undefined || schema === "public") {
    return pgTable("_ponder_checkpoint", (t) => ({
      chainName: t.text().primaryKey(),
      chainId: t.bigint({ mode: "number" }).notNull(),
      safeCheckpoint: t.varchar({ length: 75 }).notNull(),
      latestCheckpoint: t.varchar({ length: 75 }).notNull(),
      finalizedCheckpoint: t.varchar({ length: 75 }).notNull(),
    }));
  }

  return pgSchema(schema).table("_ponder_checkpoint", (t) => ({
    chainName: t.text().primaryKey(),
    chainId: t.bigint({ mode: "number" }).notNull(),
    safeCheckpoint: t.varchar({ length: 75 }).notNull(),
    latestCheckpoint: t.varchar({ length: 75 }).notNull(),
    finalizedCheckpoint: t.varchar({ length: 75 }).notNull(),
  }));
};

export const createDatabase = ({
  common,
  namespace,
  preBuild,
  schemaBuild,
}: {
  common: Common;
  namespace: NamespaceBuild;
  preBuild: Pick<PreBuild, "databaseConfig" | "ordering">;
  schemaBuild: Omit<SchemaBuild, "graphqlSchema">;
}): Database => {
  let heartbeatInterval: NodeJS.Timeout | undefined;

  const PONDER_META = getPonderMetaTable(namespace.schema);
  const PONDER_CHECKPOINT = getPonderCheckpointTable(namespace.schema);

  ////////
  // Create schema, drivers, roles, and query builders
  ////////

  let driver: PGliteDriver | PostgresDriver;
  let syncQB: QB<typeof PONDER_SYNC>;
  let adminQB: QB;
  let userQB: QB;
  let readonlyQB: QB;

  const dialect = preBuild.databaseConfig.kind;

  if (dialect === "pglite" || dialect === "pglite_test") {
    driver = {
      dialect: "pglite",
      instance:
        dialect === "pglite"
          ? createPglite(preBuild.databaseConfig.options)
          : preBuild.databaseConfig.instance,
    };

    common.shutdown.add(async () => {
      clearInterval(heartbeatInterval);

      if (["start", "dev"].includes(common.options.command)) {
        await adminQB.wrap({ label: "unlock" }, (db) =>
          db
            .update(PONDER_META)
            .set({ value: sql`jsonb_set(value, '{is_locked}', to_jsonb(0))` }),
        );
      }

      if (dialect === "pglite") {
        await (driver as PGliteDriver).instance.close();
      }
    });

    syncQB = createQB(
      drizzlePglite((driver as PGliteDriver).instance, {
        casing: "snake_case",
        schema: PONDER_SYNC,
      }),
      { common, isAdmin: false },
    );
    adminQB = createQB(
      drizzlePglite((driver as PGliteDriver).instance, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
      { common, isAdmin: true },
    );
    userQB = createQB(
      drizzlePglite((driver as PGliteDriver).instance, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
      { common, isAdmin: false },
    );
    readonlyQB = createQB(
      drizzlePglite((driver as PGliteDriver).instance, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
      { common, isAdmin: false },
    );
  } else {
    const internalMax = 2;
    const equalMax = Math.floor(
      (preBuild.databaseConfig.poolConfig.max - internalMax) / 3,
    );
    const [readonlyMax, userMax, syncMax] =
      common.options.command === "serve"
        ? [preBuild.databaseConfig.poolConfig.max - internalMax, 0, 0]
        : [equalMax, equalMax, equalMax];

    driver = {
      dialect: "postgres",
      admin: createPool(
        {
          ...preBuild.databaseConfig.poolConfig,
          application_name: `${namespace.schema}_internal`,
          max: internalMax,
          statement_timeout: 10 * 60 * 1000, // 10 minutes to accommodate slow sync store migrations.
        },
        common.logger,
      ),
      user: createPool(
        {
          ...preBuild.databaseConfig.poolConfig,
          application_name: `${namespace.schema}_user`,
          max: userMax,
        },
        common.logger,
      ),
      readonly: createReadonlyPool(
        {
          ...preBuild.databaseConfig.poolConfig,
          application_name: `${namespace.schema}_readonly`,
          max: readonlyMax,
        },
        common.logger,
        namespace.schema,
      ),
      sync: createPool(
        {
          ...preBuild.databaseConfig.poolConfig,
          application_name: "ponder_sync",
          max: syncMax,
        },
        common.logger,
      ),
    };

    syncQB = createQB(
      drizzleNodePg(driver.sync, {
        casing: "snake_case",
        schema: PONDER_SYNC,
      }),
      { common, isAdmin: false },
    );
    adminQB = createQB(
      drizzleNodePg(driver.admin, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
      { common, isAdmin: true },
    );
    userQB = createQB(
      drizzleNodePg(driver.user, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
      { common, isAdmin: false },
    );
    readonlyQB = createQB(
      drizzleNodePg(driver.readonly, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
      { common, isAdmin: false },
    );

    common.shutdown.add(async () => {
      clearInterval(heartbeatInterval);

      if (["start", "dev"].includes(common.options.command)) {
        await adminQB.wrap({ label: "unlock" }, (db) =>
          db
            .update(PONDER_META)
            .set({ value: sql`jsonb_set(value, '{is_locked}', to_jsonb(0))` }),
        );
      }

      const d = driver as PostgresDriver;

      await Promise.all([
        d.admin.end(),
        d.user.end(),
        d.readonly.end(),
        d.sync.end(),
      ]);
    });

    // Register Postgres-only metrics
    const d = driver as PostgresDriver;
    common.metrics.registry.removeSingleMetric(
      "ponder_postgres_pool_connections",
    );
    common.metrics.ponder_postgres_pool_connections = new prometheus.Gauge({
      name: "ponder_postgres_pool_connections",
      help: "Number of connections in the pool",
      labelNames: ["pool", "kind"] as const,
      registers: [common.metrics.registry],
      collect() {
        this.set({ pool: "admin", kind: "idle" }, d.admin.idleCount);
        this.set({ pool: "admin", kind: "total" }, d.admin.totalCount);
        this.set({ pool: "sync", kind: "idle" }, d.sync.idleCount);
        this.set({ pool: "sync", kind: "total" }, d.sync.totalCount);
        this.set({ pool: "user", kind: "idle" }, d.user.idleCount);
        this.set({ pool: "user", kind: "total" }, d.user.totalCount);
        this.set({ pool: "readonly", kind: "idle" }, d.readonly.idleCount);
        this.set({ pool: "readonly", kind: "total" }, d.readonly.totalCount);
      },
    });

    common.metrics.registry.removeSingleMetric(
      "ponder_postgres_query_queue_size",
    );
    common.metrics.ponder_postgres_query_queue_size = new prometheus.Gauge({
      name: "ponder_postgres_query_queue_size",
      help: "Number of queries waiting for an available connection",
      labelNames: ["pool"] as const,
      registers: [common.metrics.registry],
      collect() {
        this.set({ pool: "admin" }, d.admin.waitingCount);
        this.set({ pool: "sync" }, d.sync.waitingCount);
        this.set({ pool: "user" }, d.user.waitingCount);
        this.set({ pool: "readonly" }, d.readonly.waitingCount);
      },
    });
  }

  const tables = Object.values(schemaBuild.schema).filter(isTable);
  const views = Object.values(schemaBuild.schema).filter(isView);

  return {
    driver,
    syncQB,
    adminQB,
    userQB,
    readonlyQB,
    async migrateSync() {
      const kysely = new Kysely({
        dialect:
          dialect === "postgres"
            ? new PostgresDialect({ pool: (driver as PostgresDriver).admin })
            : createPgliteKyselyDialect((driver as PGliteDriver).instance),
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({ pool: "migrate" });
          }
        },
        plugins: [new WithSchemaPlugin("ponder_sync")],
      });

      const migrationProvider = buildMigrationProvider(common.logger);
      const migrator = new Migrator({
        db: kysely,
        provider: migrationProvider,
        migrationTableSchema: "ponder_sync",
      });

      // Note: inline operation of database wrapper because this is the only place where kysely is used
      for (let i = 0; i <= 9; i++) {
        const endClock = startClock();
        try {
          const { error } = await migrator.migrateToLatest();
          if (error) throw error;

          common.metrics.ponder_database_method_duration.observe(
            { method: "migrate_sync" },
            endClock(),
          );

          return;
        } catch (_error) {
          const error = parseDbError(_error);

          if (common.shutdown.isKilled) {
            throw new ShutdownError();
          }

          common.metrics.ponder_database_method_duration.observe(
            { method: "migrate_sync" },
            endClock(),
          );
          common.metrics.ponder_database_method_error_total.inc({
            method: "migrate_sync",
          });

          common.logger.warn({
            msg: "Failed database query",
            query: "migrate_sync",
            retry_count: i,
            error,
          });

          if (error instanceof NonRetryableUserError) {
            common.logger.warn({
              msg: "Failed database query",
              query: "migrate_sync",
              error,
            });
            throw error;
          }

          if (i === 9) {
            common.logger.warn({
              msg: "Failed database query",
              query: "migrate_sync",
              retry_count: i,
              error,
            });
            throw error;
          }

          const duration = 125 * 2 ** i;
          common.logger.debug({
            msg: "Failed database query",
            query: "migrate_sync",
            retry_count: i,
            retry_delay: duration,
            error,
          });
          await wait(duration);
        }
      }
    },
    async migrate({ buildId, chains, finalizedBlocks }) {
      const context = { logger: common.logger.child({ action: "migrate" }) };

      const createTables = async (tx: QB) => {
        for (let i = 0; i < schemaBuild.statements.tables.sql.length; i++) {
          try {
            const schemaName = schemaBuild.statements.tables.json[i]!.schema;
            const tableName = schemaBuild.statements.tables.json[i]!.tableName;

            if (
              preBuild.ordering === "experimental_isolated" &&
              tableName.startsWith("_reorg__") === false
            ) {
              const sql = schemaBuild.statements.tables.sql[i]!;
              await tx.wrap((tx) =>
                tx.execute(
                  `${sql.slice(0, sql.length - 2)} PARTITION BY LIST (chain_id);`,
                ),
              );

              for (const chain of chains) {
                await tx.wrap((tx) =>
                  tx.execute(
                    `CREATE TABLE "${schemaName}"."${getPartitionName(tableName, chain.id)}" PARTITION OF "${schemaName}"."${tableName}" FOR VALUES IN (${chain.id});`,
                  ),
                );
              }
            } else {
              await tx.wrap(
                (tx) => tx.execute(schemaBuild.statements.tables.sql[i]!),
                context,
              );
            }
          } catch (_error) {
            let error = _error as Error;
            if (!error.message.includes("already exists")) throw error;
            error = new MigrationError(
              `Unable to create table '${namespace.schema}'.'${schemaBuild.statements.tables.json[i]!.tableName}' because a table with that name already exists.`,
            );
            error.stack = undefined;
            throw error;
          }
        }

        for (const table of tables) {
          await tx.wrap(
            (tx) =>
              tx.execute(
                `CREATE INDEX IF NOT EXISTS "${getTableName(table)}_checkpoint_index" ON "${namespace.schema}"."${getReorgTableName(table)}" ("checkpoint")`,
              ),
            context,
          );
        }
      };

      const createViews = async (tx: QB) => {
        for (let i = 0; i < schemaBuild.statements.views.sql.length; i++) {
          await tx
            .wrap(
              (tx) => tx.execute(schemaBuild.statements.views.sql[i]!),
              context,
            )
            .catch((_error) => {
              const error = _error as Error;
              if (!error.message.includes("already exists")) throw error;
              const e = new MigrationError(
                `Unable to create view "${namespace.schema}"."${schemaBuild.statements.views.json[i]!.name}" because a view with that name already exists.`,
              );
              e.stack = undefined;
              throw e;
            });
        }
      };

      const createEnums = async (tx: QB) => {
        for (let i = 0; i < schemaBuild.statements.enums.sql.length; i++) {
          await tx
            .wrap(
              (tx) => tx.execute(schemaBuild.statements.enums.sql[i]!),
              context,
            )
            .catch((_error) => {
              const error = _error as Error;
              if (!error.message.includes("already exists")) throw error;
              const e = new MigrationError(
                `Unable to create enum "${namespace.schema}"."${schemaBuild.statements.enums.json[i]!.name}" because an enum with that name already exists.`,
              );
              e.stack = undefined;
              throw e;
            });
        }
      };

      const createAdminObjects = async (tx: QB) => {
        await tx.wrap(
          (tx) =>
            tx.execute(
              `
CREATE TABLE IF NOT EXISTS "${namespace.schema}"."_ponder_meta" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL
)`,
            ),
          context,
        );

        await tx.wrap(
          (tx) =>
            tx.execute(
              `
CREATE TABLE IF NOT EXISTS "${namespace.schema}"."_ponder_checkpoint" (
  "chain_name" TEXT PRIMARY KEY,
  "chain_id" BIGINT NOT NULL,
  "safe_checkpoint" VARCHAR(75) NOT NULL,
  "latest_checkpoint" VARCHAR(75) NOT NULL,
  "finalized_checkpoint" VARCHAR(75) NOT NULL
)`,
            ),
          context,
        );

        await tx.wrap(
          (tx) =>
            tx.execute(
              `CREATE SEQUENCE IF NOT EXISTS "${namespace.schema}"."${SHARED_OPERATION_ID_SEQUENCE}" AS integer INCREMENT BY 1`,
            ),
          context,
        );
      };

      const tryAcquireLockAndMigrate = () =>
        adminQB.transaction({ label: "migrate" }, async (tx) => {
          await tx.wrap(
            (tx) =>
              tx.execute(`CREATE SCHEMA IF NOT EXISTS "${namespace.schema}"`),
            context,
          );

          if (dialect === "pglite" || dialect === "pglite_test") {
            await tx.wrap(
              (tx) => tx.execute(`SET search_path TO "${namespace.schema}"`),
              context,
            );
          }

          await createAdminObjects(tx);

          let endClock = startClock();

          common.logger.debug({
            msg: "Created internal database objects",
            schema: namespace.schema,
            table_count: 2,
            trigger_count: 2,
            duration: endClock(),
          });

          // Note: All ponder versions are compatible with the next query (every version of the "_ponder_meta" table have the same columns)

          const previousApp = await tx.wrap(
            (tx) =>
              tx
                .select({ value: PONDER_META.value })
                .from(PONDER_META)
                .where(eq(PONDER_META.key, "app"))
                .then((result) => result[0]?.value),
            context,
          );

          const metadata = {
            version: VERSION,
            build_id: buildId,
            table_names: tables.map(getTableName),
            view_names: views.map(getViewName),
            is_dev: common.options.command === "dev" ? 1 : 0,
            is_locked: 1,
            is_ready: 0,
            heartbeat_at: Date.now(),
          } satisfies PonderApp5;

          if (previousApp === undefined) {
            endClock = startClock();
            await createEnums(tx);
            await createTables(tx);
            await createViews(tx);
            await createLiveQueryProcedures(
              tx,
              { namespaceBuild: namespace },
              context,
            );

            common.logger.info({
              msg: "Created database tables",
              count: tables.length,
              tables: JSON.stringify(tables.map(getTableName)),
              duration: endClock(),
            });

            if (views.length > 0) {
              common.logger.info({
                msg: "Created database views",
                count: views.length,
                views: JSON.stringify(views.map(getViewName)),
                duration: endClock(),
              });
            }

            await tx.wrap(
              (tx) =>
                tx.insert(PONDER_META).values({ key: "app", value: metadata }),
              context,
            );
            return {
              status: "success",
              crashRecoveryCheckpoint: undefined,
            } as const;
          }

          if (previousApp.is_dev === 1) {
            endClock = startClock();

            for (const table of previousApp.table_names ?? []) {
              await tx.wrap(
                (tx) =>
                  tx.execute(
                    `DROP TABLE IF EXISTS "${namespace.schema}"."${table}" CASCADE`,
                  ),
                context,
              );
              await tx.wrap(
                (tx) =>
                  tx.execute(
                    `DROP TABLE IF EXISTS "${namespace.schema}"."${sqlToReorgTableName(table)}" CASCADE`,
                  ),
                context,
              );
            }
            for (const view of previousApp.view_names ?? []) {
              await tx.wrap(
                (tx) =>
                  tx.execute(
                    `DROP VIEW IF EXISTS "${namespace.schema}"."${view}" CASCADE`,
                  ),
                context,
              );
            }
            for (const enumName of schemaBuild.statements.enums.json) {
              await tx.wrap(
                (tx) =>
                  tx.execute(
                    `DROP TYPE IF EXISTS "${namespace.schema}"."${enumName.name}"`,
                  ),
                context,
              );
            }

            common.logger.warn({
              msg: "Dropped existing database tables",
              count: previousApp.table_names?.length,
              tables: JSON.stringify(previousApp.table_names),
              duration: endClock(),
            });
            if (previousApp.view_names?.length > 0) {
              common.logger.warn({
                msg: "Dropped existing database views",
                count: previousApp.view_names?.length,
                views: JSON.stringify(previousApp.view_names),
              });
            }

            endClock = startClock();

            await createEnums(tx);
            await createTables(tx);
            await createViews(tx);

            common.logger.info({
              msg: "Created database tables",
              count: tables.length,
              tables: JSON.stringify(tables.map(getTableName)),
              duration: endClock(),
            });

            if (views.length > 0) {
              common.logger.info({
                msg: "Created database views",
                count: views.length,
                views: JSON.stringify(views.map(getViewName)),
                duration: endClock(),
              });
            }

            endClock = startClock();

            await tx.wrap(
              (tx) =>
                tx.execute(
                  `DROP TABLE IF EXISTS "${namespace.schema}"."${getTableName(PONDER_CHECKPOINT)}" CASCADE`,
                ),
              context,
            );

            await tx.wrap(
              (tx) =>
                tx.execute(
                  `DROP TABLE IF EXISTS "${namespace.schema}"."${getTableName(PONDER_META)}" CASCADE`,
                ),
              context,
            );

            await tx.wrap((tx) =>
              tx.execute(
                `DROP FUNCTION IF EXISTS "${namespace.schema}".${getLiveQueryProcedureName()}`,
              ),
            );

            await tx.wrap((tx) =>
              tx.execute(
                `DROP FUNCTION IF EXISTS "${namespace.schema}".${getLiveQueryNotifyProcedureName()}`,
              ),
            );

            await createAdminObjects(tx);
            await createLiveQueryProcedures(
              tx,
              { namespaceBuild: namespace },
              context,
            );

            common.logger.debug({
              msg: "Reset internal database objects",
              schema: namespace.schema,
              duration: endClock(),
            });

            await tx.wrap(
              (tx) =>
                tx.insert(PONDER_META).values({ key: "app", value: metadata }),
              context,
            );
            return {
              status: "success",
              crashRecoveryCheckpoint: undefined,
            } as const;
          }

          // Note: ponder <=0.8 will evaluate this as true because the version is undefined
          if (previousApp.version !== VERSION) {
            const error = new MigrationError(
              `Schema "${namespace.schema}" was previously used by a Ponder app with a different minor version. Drop the schema first, or use a different schema. Read more: https://ponder.sh/docs/database#database-schema`,
            );
            error.stack = undefined;
            throw error;
          }

          if (
            process.env.PONDER_EXPERIMENTAL_DB !== "platform" &&
            (common.options.command === "dev" ||
              previousApp.build_id !== buildId)
          ) {
            const error = new MigrationError(
              `Schema "${namespace.schema}" was previously used by a different Ponder app. Drop the schema first, or use a different schema. Read more: https://ponder.sh/docs/database#database-schema`,
            );
            error.stack = undefined;
            throw error;
          }

          const expiry =
            previousApp.heartbeat_at + common.options.databaseHeartbeatTimeout;

          const isAppUnlocked =
            previousApp.is_locked === 0 || expiry <= Date.now();

          if (isAppUnlocked === false) {
            return { status: "locked", expiry } as const;
          }

          common.logger.info({
            msg: "Detected crash recovery",
            build_id: buildId,
            last_active: `${formatEta(Date.now() - previousApp.heartbeat_at)}s`,
            schema: namespace.schema,
          });

          const checkpoints = await tx.wrap(
            (tx) => tx.select().from(PONDER_CHECKPOINT),
            context,
          );

          // Note: The previous app can be in three possible states:
          // 1. Has no checkpoints, hasn't made it past the setup events
          // 2. Has checkpoints but hasn't made it past the historical backfill
          // 3. Has checkpoints and has made it past the historical backfill

          if (checkpoints.length === 0) {
            return {
              status: "success",
              crashRecoveryCheckpoint: undefined,
            } as const;
          }

          for (const { chainId, finalizedCheckpoint } of checkpoints) {
            const finalizedBlock =
              finalizedBlocks[chains.findIndex((c) => c.id === chainId)]!;
            if (
              hexToBigInt(finalizedBlock.timestamp) <
              decodeCheckpoint(finalizedCheckpoint).blockTimestamp
            ) {
              throw new MigrationError(
                `Finalized block for chain "${chainId}" cannot move backwards`,
              );
            }
          }

          const crashRecoveryCheckpoint = checkpoints.map((c) => ({
            chainId: c.chainId,
            checkpoint: c.safeCheckpoint,
          }));

          // Note: The statements below will not affect chains that are not "live".

          // Remove triggers

          if (preBuild.ordering === "experimental_isolated") {
            for (const { chainId } of checkpoints) {
              await dropTriggers(tx, { tables, chainId });
              await dropLiveQueryTriggers(
                tx,
                { namespaceBuild: namespace, tables, chainId },
                context,
              );
            }
          } else {
            await dropTriggers(tx, { tables });
            await dropLiveQueryTriggers(
              tx,
              { namespaceBuild: namespace, tables },
              context,
            );
          }

          // Remove indexes

          for (const indexStatement of schemaBuild.statements.indexes.json) {
            await tx.wrap(
              (tx) =>
                tx.execute(
                  `DROP INDEX IF EXISTS "${namespace.schema}"."${indexStatement.data.name}"`,
                ),
              context,
            );
          }

          for (const table of tables) {
            await crashRecovery(tx, { table });
          }

          // Note: We don't update the `_ponder_checkpoint` table here, instead we wait for it to be updated
          // in the runtime script.

          await tx.wrap(
            (tx) => tx.update(PONDER_META).set({ value: metadata }),
            context,
          );
          return { status: "success", crashRecoveryCheckpoint } as const;
        });

      let result = await tryAcquireLockAndMigrate();
      if (result.status === "locked") {
        const duration = result.expiry - Date.now();
        common.logger.warn({
          msg: "Schema is locked by a different Ponder app",
          schema: namespace.schema,
          retry_delay: duration,
        });

        await wait(duration);

        result = await tryAcquireLockAndMigrate();
        if (result.status === "locked") {
          const error = new MigrationError(
            `Failed to acquire lock on schema "${namespace.schema}". A different Ponder app is actively using this schema.`,
          );
          error.stack = undefined;
          throw error;
        }
      }

      heartbeatInterval = setInterval(async () => {
        try {
          const heartbeat = Date.now();

          const endClock = startClock();

          await adminQB.wrap({ label: "update_heartbeat" }, (db) =>
            db.update(PONDER_META).set({
              value: sql`jsonb_set(value, '{heartbeat_at}', ${heartbeat})`,
            }),
          );

          common.logger.trace({
            msg: "Updated heartbeat timestamp",
            heartbeat,
            build_id: buildId,
            schema: namespace.schema,
            duration: endClock(),
          });
        } catch (err) {
          const error = err as Error;
          common.logger.error({
            msg: "Failed to update heartbeat timestamp",
            retry_delay: common.options.databaseHeartbeatInterval,
            error,
          });
        }
      }, common.options.databaseHeartbeatInterval);

      return result.crashRecoveryCheckpoint;
    },
  };
};
