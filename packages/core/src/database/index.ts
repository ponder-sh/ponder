import { getTableNames } from "@/drizzle/index.js";
import { sqlToReorgTableName } from "@/drizzle/kit/index.js";
import type { Common } from "@/internal/common.js";
import { NonRetryableError, ShutdownError } from "@/internal/errors.js";
import type {
  CrashRecoveryCheckpoint,
  IndexingBuild,
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
} from "@/internal/types.js";
import { buildMigrationProvider } from "@/sync-store/migrations.js";
import * as PONDER_SYNC from "@/sync-store/schema.js";
import { min } from "@/utils/checkpoint.js";
import { formatEta } from "@/utils/format.js";
import { createPool, createReadonlyPool } from "@/utils/pg.js";
import { createPglite, createPgliteKyselyDialect } from "@/utils/pglite.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import type { PGlite } from "@electric-sql/pglite";
import { eq, getTableName, is, sql } from "drizzle-orm";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { PgTable, pgSchema, pgTable } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Kysely, Migrator, PostgresDialect, WithSchemaPlugin } from "kysely";
import type { Pool, PoolClient } from "pg";
import prometheus from "prom-client";
import { type QB, createQB, parseSqlError } from "./queryBuilder.js";
import { revert } from "./utils.js";

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
  }: Pick<IndexingBuild, "buildId">): Promise<CrashRecoveryCheckpoint>;
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

export type PonderApp = {
  version: string;
  build_id: string;
  table_names: string[];
  is_locked: 0 | 1;
  is_dev: 0 | 1;
  is_ready: 0 | 1;
  heartbeat_at: number;
};

const VERSION = "2";

type PGliteDriver = {
  dialect: "pglite";
  instance: PGlite;
};

type PostgresDriver = {
  dialect: "postgres";
  sync: Pool;
  admin: Pool;
  user: Pool;
  readonly: Pool;
  listen: PoolClient | undefined;
};

export const getPonderMetaTable = (schema?: string) => {
  if (schema === undefined || schema === "public") {
    return pgTable("_ponder_meta", (t) => ({
      key: t.text().primaryKey().$type<"app">(),
      value: t.jsonb().$type<PonderApp>().notNull(),
    }));
  }

  return pgSchema(schema).table("_ponder_meta", (t) => ({
    key: t.text().primaryKey().$type<"app">(),
    value: t.jsonb().$type<PonderApp>().notNull(),
  }));
};

/**
 * - "safe" checkpoint: The closest-to-tip finalized and completed checkpoint.
 * - "latest" checkpoint: The closest-to-tip completed checkpoint.
 *
 * @dev It is an invariant that every "latest" checkpoint is specific to that chain.
 * In other words, `chainId === latestCheckpoint.chainId`.
 */
export const getPonderCheckpointTable = (schema?: string) => {
  if (schema === undefined || schema === "public") {
    return pgTable("_ponder_checkpoint", (t) => ({
      chainName: t.text().primaryKey(),
      chainId: t.bigint({ mode: "number" }).notNull(),
      safeCheckpoint: t.varchar({ length: 75 }).notNull(),
      latestCheckpoint: t.varchar({ length: 75 }).notNull(),
    }));
  }

  return pgSchema(schema).table("_ponder_checkpoint", (t) => ({
    chainName: t.text().primaryKey(),
    chainId: t.bigint({ mode: "number" }).notNull(),
    safeCheckpoint: t.varchar({ length: 75 }).notNull(),
    latestCheckpoint: t.varchar({ length: 75 }).notNull(),
  }));
};

export const createDatabase = async ({
  common,
  namespace,
  preBuild,
  schemaBuild,
}: {
  common: Common;
  namespace: NamespaceBuild;
  preBuild: Pick<PreBuild, "databaseConfig">;
  schemaBuild: Omit<SchemaBuild, "graphqlSchema">;
}): Promise<Database> => {
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

  if (namespace.viewsSchema) {
    common.logger.info({
      service: "database",
      msg: `Using database schema '${namespace.schema}' and views schema '${namespace.viewsSchema}'`,
    });
  } else {
    common.logger.info({
      service: "database",
      msg: `Using database schema '${namespace.schema}'`,
    });
  }

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
        await adminQB("unlock")
          .update(PONDER_META)
          .set({ value: sql`jsonb_set(value, '{is_locked}', to_jsonb(0))` });
      }

      if (dialect === "pglite") {
        await (driver as PGliteDriver).instance.close();
      }
    });

    await driver.instance.query(
      `CREATE SCHEMA IF NOT EXISTS "${namespace.schema}"`,
    );
    await driver.instance.query(`SET search_path TO "${namespace.schema}"`);

    syncQB = createQB(
      common,
      drizzlePglite((driver as PGliteDriver).instance, {
        casing: "snake_case",
        schema: PONDER_SYNC,
      }),
    );
    adminQB = createQB(
      common,
      drizzlePglite((driver as PGliteDriver).instance, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
      true,
    );
    userQB = createQB(
      common,
      drizzlePglite((driver as PGliteDriver).instance, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
    );
    readonlyQB = createQB(
      common,
      drizzlePglite((driver as PGliteDriver).instance, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
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
      sync: createPool(
        {
          ...preBuild.databaseConfig.poolConfig,
          application_name: "ponder_sync",
          max: syncMax,
        },
        common.logger,
      ),
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
      listen: undefined,
    } as PostgresDriver;

    await driver.admin.query(
      `CREATE SCHEMA IF NOT EXISTS "${namespace.schema}"`,
    );

    syncQB = createQB(
      common,
      drizzleNodePg(driver.sync, {
        casing: "snake_case",
        schema: PONDER_SYNC,
      }),
    );
    adminQB = createQB(
      common,
      drizzleNodePg(driver.admin, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
      true,
    );
    userQB = createQB(
      common,
      drizzleNodePg(driver.user, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
    );
    readonlyQB = createQB(
      common,
      drizzleNodePg(driver.readonly, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
    );

    common.shutdown.add(async () => {
      clearInterval(heartbeatInterval);

      if (["start", "dev"].includes(common.options.command)) {
        await adminQB("unlock")
          .update(PONDER_META)
          .set({ value: sql`jsonb_set(value, '{is_locked}', to_jsonb(0))` });
      }

      const d = driver as PostgresDriver;
      d.listen?.release();
      await Promise.all([
        d.sync.end(),
        d.admin.end(),
        d.user.end(),
        d.readonly.end(),
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

  const tables = Object.values(schemaBuild.schema).filter(
    (table): table is PgTable => is(table, PgTable),
  );

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
          const error = parseSqlError(_error);

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

          if (error instanceof NonRetryableError) {
            common.logger.warn({
              service: "database",
              msg: `Failed 'migrate_sync' database query`,
              error,
            });
            throw error;
          }

          if (i === 9) {
            common.logger.warn({
              service: "database",
              msg: `Failed 'migrate_sync' database query after '${i + 1}' attempts`,
              error,
            });
            throw error;
          }

          const duration = 125 * 2 ** i;
          common.logger.debug({
            service: "database",
            msg: `Failed 'migrate_sync' database query, retrying after ${duration} milliseconds`,
            error,
          });
          await wait(duration);
        }
      }
    },
    async migrate({ buildId }) {
      await adminQB("create_meta_table").execute(
        sql.raw(`
CREATE TABLE IF NOT EXISTS "${namespace.schema}"."_ponder_meta" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL
)`),
      );

      await adminQB("create_checkpoint_table").execute(
        sql.raw(`
CREATE TABLE IF NOT EXISTS "${namespace.schema}"."_ponder_checkpoint" (
  "chain_name" TEXT PRIMARY KEY,
  "chain_id" INTEGER NOT NULL,
  "safe_checkpoint" VARCHAR(75) NOT NULL,
  "latest_checkpoint" VARCHAR(75) NOT NULL
)`),
      );

      const trigger = "status_trigger";
      const notification = "status_notify()";
      const channel = `${namespace.schema}_status_channel`;

      await adminQB("create_system_notification").execute(
        sql.raw(`
CREATE OR REPLACE FUNCTION "${namespace.schema}".${notification}
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
NOTIFY "${channel}";
RETURN NULL;
END;
$$;`),
      );

      await adminQB("create_system_trigger").execute(
        sql.raw(`
CREATE OR REPLACE TRIGGER "${trigger}"
AFTER INSERT OR UPDATE OR DELETE
ON "${namespace.schema}"._ponder_checkpoint
FOR EACH STATEMENT
EXECUTE PROCEDURE "${namespace.schema}".${notification};`),
      );

      const createTables = async (tx: QB) => {
        for (let i = 0; i < schemaBuild.statements.tables.sql.length; i++) {
          await tx()
            .execute(sql.raw(schemaBuild.statements.tables.sql[i]!))
            .catch((_error) => {
              const error = _error as Error;
              if (!error.message.includes("already exists")) throw error;
              const e = new NonRetryableError(
                `Unable to create table '${namespace.schema}'.'${schemaBuild.statements.tables.json[i]!.tableName}' because a table with that name already exists.`,
              );
              e.stack = undefined;
              throw e;
            });
        }
      };

      const createEnums = async (tx: QB) => {
        for (let i = 0; i < schemaBuild.statements.enums.sql.length; i++) {
          await tx()
            .execute(sql.raw(schemaBuild.statements.enums.sql[i]!))
            .catch((_error) => {
              const error = _error as Error;
              if (!error.message.includes("already exists")) throw error;
              const e = new NonRetryableError(
                `Unable to create enum '${namespace.schema}'.'${schemaBuild.statements.enums.json[i]!.name}' because an enum with that name already exists.`,
              );
              e.stack = undefined;
              throw e;
            });
        }
      };

      const tryAcquireLockAndMigrate = () =>
        adminQB("migrate").transaction(async (tx) => {
          // Note: All ponder versions are compatible with the next query (every version of the "_ponder_meta" table have the same columns)

          const previousApp = await tx()
            .select({ value: PONDER_META.value })
            .from(PONDER_META)
            .where(eq(PONDER_META.key, "app"))
            .then((result) => result[0]?.value);

          const metadata = {
            version: VERSION,
            build_id: buildId,
            table_names: tables.map(getTableName),
            is_dev: common.options.command === "dev" ? 1 : 0,
            is_locked: 1,
            is_ready: 0,
            heartbeat_at: Date.now(),
          } satisfies PonderApp;

          if (previousApp === undefined) {
            await createEnums(tx);
            await createTables(tx);

            common.logger.info({
              service: "database",
              msg: `Created tables [${tables.map(getTableName).join(", ")}]`,
            });

            await tx()
              .insert(PONDER_META)
              .values({ key: "app", value: metadata });
            return {
              status: "success",
              crashRecoveryCheckpoint: undefined,
            } as const;
          }

          if (
            previousApp.is_dev === 1 ||
            (process.env.PONDER_EXPERIMENTAL_DB === "platform" &&
              previousApp.build_id !== buildId)
          ) {
            for (const table of previousApp.table_names) {
              await tx().execute(
                sql.raw(
                  `DROP TABLE IF EXISTS "${namespace.schema}"."${table}" CASCADE`,
                ),
              );
              await tx().execute(
                sql.raw(
                  `DROP TABLE IF EXISTS "${namespace.schema}"."${sqlToReorgTableName(table)}" CASCADE`,
                ),
              );
            }
            for (const enumName of schemaBuild.statements.enums.json) {
              await tx().execute(
                sql.raw(
                  `DROP TYPE IF EXISTS "${namespace.schema}"."${enumName.name}"`,
                ),
              );
            }

            await tx().execute(
              sql.raw(
                `TRUNCATE TABLE "${namespace.schema}"."${getTableName(PONDER_CHECKPOINT)}" CASCADE`,
              ),
            );

            await createEnums(tx);
            await createTables(tx);

            common.logger.info({
              service: "database",
              msg: `Created tables [${tables.map(getTableName).join(", ")}]`,
            });

            await tx().update(PONDER_META).set({ value: metadata });
            return {
              status: "success",
              crashRecoveryCheckpoint: undefined,
            } as const;
          }

          // Note: ponder <=0.8 will evaluate this as true because the version is undefined
          if (previousApp.version !== VERSION) {
            const error = new NonRetryableError(
              `Schema '${namespace.schema}' was previously used by a Ponder app with a different minor version. Drop the schema first, or use a different schema. Read more: https://ponder.sh/docs/database#database-schema`,
            );
            error.stack = undefined;
            throw error;
          }

          if (
            common.options.command === "dev" ||
            previousApp.build_id !== buildId
          ) {
            const error = new NonRetryableError(
              `Schema '${namespace.schema}' was previously used by a different Ponder app. Drop the schema first, or use a different schema. Read more: https://ponder.sh/docs/database#database-schema`,
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
            service: "database",
            msg: `Detected crash recovery for build '${buildId}' in schema '${namespace.schema}' last active ${formatEta(Date.now() - previousApp.heartbeat_at)} ago`,
          });

          const checkpoints = await tx().select().from(PONDER_CHECKPOINT);
          const crashRecoveryCheckpoint =
            checkpoints.length === 0
              ? undefined
              : checkpoints.map((c) => ({
                  chainId: c.chainId,
                  checkpoint: c.safeCheckpoint,
                }));

          if (previousApp.is_ready === 0) {
            await tx().update(PONDER_META).set({ value: metadata });
            return { status: "success", crashRecoveryCheckpoint } as const;
          }

          // Remove triggers

          for (const table of tables) {
            await tx().execute(
              sql.raw(
                `DROP TRIGGER IF EXISTS "${getTableNames(table).trigger}" ON "${namespace.schema}"."${getTableName(table)}"`,
              ),
            );
          }

          // Remove indexes

          for (const indexStatement of schemaBuild.statements.indexes.json) {
            await tx().execute(
              sql.raw(
                `DROP INDEX IF EXISTS "${namespace.schema}"."${indexStatement.data.name}"`,
              ),
            );
            common.logger.debug({
              service: "database",
              msg: `Dropped index '${indexStatement.data.name}' in schema '${namespace.schema}'`,
            });
          }

          // Note: it is an invariant that checkpoints.length > 0;
          const revertCheckpoint = min(
            ...checkpoints.map((c) => c.safeCheckpoint),
          );

          await Promise.all(
            tables.map((table) =>
              revert(tx, { checkpoint: revertCheckpoint, table }),
            ),
          );

          // Note: We don't update the `_ponder_checkpoint` table here, instead we wait for it to be updated
          // in the runtime script.

          await tx().update(PONDER_META).set({ value: metadata });
          return { status: "success", crashRecoveryCheckpoint } as const;
        });

      let result = await tryAcquireLockAndMigrate();
      if (result.status === "locked") {
        const duration = result.expiry - Date.now();
        common.logger.warn({
          service: "database",
          msg: `Schema '${namespace.schema}' is locked by a different Ponder app`,
        });
        common.logger.warn({
          service: "database",
          msg: `Waiting ${formatEta(duration)} for lock on schema '${namespace.schema}' to expire...`,
        });

        await wait(duration);

        result = await tryAcquireLockAndMigrate();
        if (result.status === "locked") {
          const error = new NonRetryableError(
            `Failed to acquire lock on schema '${namespace.schema}'. A different Ponder app is actively using this schema.`,
          );
          error.stack = undefined;
          throw error;
        }
      }

      heartbeatInterval = setInterval(async () => {
        try {
          const heartbeat = Date.now();

          await adminQB("heartbeat")
            .update(PONDER_META)
            .set({
              value: sql`jsonb_set(value, '{heartbeat_at}', ${heartbeat})`,
            });

          common.logger.trace({
            service: "database",
            msg: `Updated heartbeat timestamp to ${heartbeat} (build_id=${buildId})`,
          });
        } catch (err) {
          const error = err as Error;
          common.logger.error({
            service: "database",
            msg: `Failed to update heartbeat timestamp, retrying in ${formatEta(
              common.options.databaseHeartbeatInterval,
            )}`,
            error,
          });
        }
      }, common.options.databaseHeartbeatInterval);

      return result.crashRecoveryCheckpoint;
    },
  };
};
