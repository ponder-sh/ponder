import { isMainThread } from "node:worker_threads";
import { getPartitionName, getReorgTableName } from "@/drizzle/index.js";
import {
  SHARED_OPERATION_ID_SEQUENCE,
  sqlToReorgTableName,
} from "@/drizzle/kit/index.js";
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
import { eq, getTableName, isTable, sql } from "drizzle-orm";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { pgSchema, pgTable } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Kysely, Migrator, PostgresDialect, WithSchemaPlugin } from "kysely";
import type { Pool } from "pg";
import prometheus from "prom-client";
import { hexToBigInt } from "viem";
import { crashRecovery, dropTriggers } from "./actions.js";
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
    indexingBuild,
    preBuild,
  }: {
    indexingBuild: Pick<
      IndexingBuild,
      "buildId" | "chains" | "finalizedBlocks"
    >;
    preBuild: Pick<PreBuild, "ordering">;
  }): Promise<CrashRecoveryCheckpoint>;
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

const VERSION = "4";

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
      value: t.jsonb().$type<PonderApp>().notNull(),
    }));
  }

  return pgSchema(schema).table("_ponder_meta", (t) => ({
    key: t.text().primaryKey().$type<"app">(),
    value: t.jsonb().$type<PonderApp>().notNull(),
  }));
};

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
  preBuild: Pick<PreBuild, "databaseConfig">;
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

  if (isMainThread) {
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

          if (error instanceof NonRetryableUserError) {
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
    async migrate({ indexingBuild, preBuild }) {
      const createTables = async (tx: QB) => {
        for (let i = 0; i < schemaBuild.statements.tables.sql.length; i++) {
          try {
            const schemaName = schemaBuild.statements.tables.json[i]!.schema;
            const tableName = schemaBuild.statements.tables.json[i]!.tableName;
            if (
              preBuild.ordering === "isolated" &&
              tableName.startsWith("_reorg__") === false
            ) {
              const sql = schemaBuild.statements.tables.sql[i]!;
              await tx.wrap((tx) =>
                tx.execute(
                  `${sql.slice(0, sql.length - 2)} PARTITION BY LIST (chain_id);`,
                ),
              );

              for (const chain of indexingBuild.chains) {
                await tx.wrap((tx) =>
                  tx.execute(
                    `CREATE TABLE "${schemaName}"."${getPartitionName(tableName, chain.id)}" PARTITION OF "${schemaName}"."${tableName}" FOR VALUES IN (${chain.id});`,
                  ),
                );
              }
            } else {
              await tx.wrap((tx) =>
                tx.execute(schemaBuild.statements.tables.sql[i]!),
              );
            }
          } catch (_error) {
            const error = _error as Error;
            if (!error.message.includes("already exists")) throw error;
            const e = new MigrationError(
              `Unable to create table '${namespace.schema}'.'${schemaBuild.statements.tables.json[i]!.tableName}' because a table with that name already exists.`,
            );
            e.stack = undefined;
            throw e;
          }
        }

        for (const table of tables) {
          await tx.wrap((tx) =>
            tx.execute(
              `CREATE INDEX IF NOT EXISTS "${getTableName(table)}_checkpoint_index" ON "${namespace.schema}"."${getReorgTableName(table)}" ("checkpoint")`,
            ),
          );
        }
      };

      const createEnums = async (tx: QB) => {
        for (let i = 0; i < schemaBuild.statements.enums.sql.length; i++) {
          await tx
            .wrap((tx) => tx.execute(schemaBuild.statements.enums.sql[i]!))
            .catch((_error) => {
              const error = _error as Error;
              if (!error.message.includes("already exists")) throw error;
              const e = new MigrationError(
                `Unable to create enum '${namespace.schema}'.'${schemaBuild.statements.enums.json[i]!.name}' because an enum with that name already exists.`,
              );
              e.stack = undefined;
              throw e;
            });
        }
      };

      const createAdminObjects = async (tx: QB) => {
        await tx.wrap((tx) =>
          tx.execute(
            `
CREATE TABLE IF NOT EXISTS "${namespace.schema}"."_ponder_meta" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL
)`,
          ),
        );

        await tx.wrap((tx) =>
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
        );

        await tx.wrap((tx) =>
          tx.execute(
            `CREATE SEQUENCE IF NOT EXISTS "${namespace.schema}"."${SHARED_OPERATION_ID_SEQUENCE}" AS integer INCREMENT BY 1`,
          ),
        );

        const trigger = "status_trigger";
        const notification = "status_notify()";
        const channel = `${namespace.schema}_status_channel`;

        await tx.wrap((tx) =>
          tx.execute(
            `
CREATE OR REPLACE FUNCTION "${namespace.schema}".${notification}
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
NOTIFY "${channel}";
RETURN NULL;
END;
$$;`,
          ),
        );

        await tx.wrap((tx) =>
          tx.execute(
            `
CREATE OR REPLACE TRIGGER "${trigger}"
AFTER INSERT OR UPDATE OR DELETE
ON "${namespace.schema}"._ponder_checkpoint
FOR EACH STATEMENT
EXECUTE PROCEDURE "${namespace.schema}".${notification};`,
          ),
        );
      };

      const tryAcquireLockAndMigrate = () =>
        adminQB.transaction({ label: "migrate" }, async (tx) => {
          await tx.wrap((tx) =>
            tx.execute(`CREATE SCHEMA IF NOT EXISTS "${namespace.schema}"`),
          );

          if (dialect === "pglite" || dialect === "pglite_test") {
            await tx.wrap((tx) =>
              tx.execute(`SET search_path TO "${namespace.schema}"`),
            );
          }

          await createAdminObjects(tx);

          // Note: All ponder versions are compatible with the next query (every version of the "_ponder_meta" table have the same columns)

          const previousApp = await tx.wrap((tx) =>
            tx
              .select({ value: PONDER_META.value })
              .from(PONDER_META)
              .where(eq(PONDER_META.key, "app"))
              .then((result) => result[0]?.value),
          );

          const metadata = {
            version: VERSION,
            build_id: indexingBuild.buildId,
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

            await tx.wrap((tx) =>
              tx.insert(PONDER_META).values({ key: "app", value: metadata }),
            );
            return {
              status: "success",
              crashRecoveryCheckpoint: undefined,
            } as const;
          }

          if (previousApp.is_dev === 1) {
            for (const table of previousApp.table_names) {
              await tx.wrap((tx) =>
                tx.execute(
                  `DROP TABLE IF EXISTS "${namespace.schema}"."${table}" CASCADE`,
                ),
              );
              await tx.wrap((tx) =>
                tx.execute(
                  `DROP TABLE IF EXISTS "${namespace.schema}"."${sqlToReorgTableName(table)}" CASCADE`,
                ),
              );
            }
            for (const enumName of schemaBuild.statements.enums.json) {
              await tx.wrap((tx) =>
                tx.execute(
                  `DROP TYPE IF EXISTS "${namespace.schema}"."${enumName.name}"`,
                ),
              );
            }

            await createEnums(tx);
            await createTables(tx);

            await tx.wrap((tx) =>
              tx.execute(
                `DROP TABLE IF EXISTS "${namespace.schema}"."${getTableName(PONDER_CHECKPOINT)}" CASCADE`,
              ),
            );

            await tx.wrap((tx) =>
              tx.execute(
                `DROP TABLE IF EXISTS "${namespace.schema}"."${getTableName(PONDER_META)}" CASCADE`,
              ),
            );

            await createAdminObjects(tx);

            common.logger.info({
              service: "database",
              msg: `Created tables [${tables.map(getTableName).join(", ")}]`,
            });

            await tx.wrap((tx) =>
              tx.insert(PONDER_META).values({ key: "app", value: metadata }),
            );
            return {
              status: "success",
              crashRecoveryCheckpoint: undefined,
            } as const;
          }

          // Note: ponder <=0.8 will evaluate this as true because the version is undefined
          if (previousApp.version !== VERSION) {
            const error = new MigrationError(
              `Schema '${namespace.schema}' was previously used by a Ponder app with a different minor version. Drop the schema first, or use a different schema. Read more: https://ponder.sh/docs/database#database-schema`,
            );
            error.stack = undefined;
            throw error;
          }

          if (
            process.env.PONDER_EXPERIMENTAL_DB !== "platform" &&
            (common.options.command === "dev" ||
              previousApp.build_id !== indexingBuild.buildId)
          ) {
            const error = new MigrationError(
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
            msg: `Detected crash recovery for build '${indexingBuild.buildId}' in schema '${namespace.schema}' last active ${formatEta(Date.now() - previousApp.heartbeat_at)} ago`,
          });

          const checkpoints = await tx.wrap((tx) =>
            tx.select().from(PONDER_CHECKPOINT),
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
              indexingBuild.finalizedBlocks[
                indexingBuild.chains.findIndex((c) => c.id === chainId)
              ]!;
            if (
              hexToBigInt(finalizedBlock.timestamp) <
              decodeCheckpoint(finalizedCheckpoint).blockTimestamp
            ) {
              throw new MigrationError(
                `Finalized block for chain '${chainId}' cannot move backwards`,
              );
            }
          }

          const crashRecoveryCheckpoint = checkpoints.map((c) => ({
            chainId: c.chainId,
            checkpoint: c.safeCheckpoint,
          }));

          if (previousApp.is_ready === 0) {
            await tx.wrap((tx) =>
              tx.update(PONDER_META).set({ value: metadata }),
            );
            return { status: "success", crashRecoveryCheckpoint } as const;
          }

          if (preBuild.ordering === "isolated") {
            for (const { chainId } of checkpoints) {
              await dropTriggers(tx, { tables, chainId });
            }
          } else {
            await dropTriggers(tx, { tables });
          }

          // Remove indexes

          for (const indexStatement of schemaBuild.statements.indexes.json) {
            await tx.wrap((tx) =>
              tx.execute(
                `DROP INDEX IF EXISTS "${namespace.schema}"."${indexStatement.data.name}"`,
              ),
            );
            common.logger.debug({
              service: "database",
              msg: `Dropped index '${indexStatement.data.name}' in schema '${namespace.schema}'`,
            });
          }

          for (const table of tables) {
            await crashRecovery(tx, { table });
          }

          // Note: We don't update the `_ponder_checkpoint` table here, instead we wait for it to be updated
          // in the runtime script.

          await tx.wrap((tx) =>
            tx.update(PONDER_META).set({ value: metadata }),
          );
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
          const error = new MigrationError(
            `Failed to acquire lock on schema '${namespace.schema}'. A different Ponder app is actively using this schema.`,
          );
          error.stack = undefined;
          throw error;
        }
      }

      heartbeatInterval = setInterval(async () => {
        try {
          const heartbeat = Date.now();

          await adminQB.wrap({ label: "update_heartbeat" }, (db) =>
            db.update(PONDER_META).set({
              value: sql`jsonb_set(value, '{heartbeat_at}', ${heartbeat})`,
            }),
          );

          common.logger.trace({
            service: "database",
            msg: `Updated heartbeat timestamp to ${heartbeat} (build_id=${indexingBuild.buildId})`,
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
