import { getPrimaryKeyColumns, getTableNames } from "@/drizzle/index.js";
import {
  SHARED_OPERATION_ID_SEQUENCE,
  getColumnCasing,
  getReorgTable,
  sqlToReorgTableName,
} from "@/drizzle/kit/index.js";
import type { Common } from "@/internal/common.js";
import { NonRetryableError } from "@/internal/errors.js";
import type {
  CrashRecoveryCheckpoint,
  IndexingBuild,
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
} from "@/internal/types.js";
import { buildMigrationProvider } from "@/sync-store/migrations.js";
import * as PONDER_SYNC from "@/sync-store/schema.js";
import {
  MAX_CHECKPOINT_STRING,
  decodeCheckpoint,
  min,
} from "@/utils/checkpoint.js";
import { formatEta } from "@/utils/format.js";
import { createPool, createReadonlyPool } from "@/utils/pg.js";
import { createPglite, createPgliteKyselyDialect } from "@/utils/pglite.js";
import { wait } from "@/utils/wait.js";
import type { PGlite } from "@electric-sql/pglite";
import {
  eq,
  getTableColumns,
  getTableName,
  isTable,
  lte,
  sql,
} from "drizzle-orm";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { pgSchema, pgTable } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Kysely, Migrator, PostgresDialect, WithSchemaPlugin } from "kysely";
import type { Pool, PoolClient } from "pg";
import prometheus from "prom-client";
import { type QB, createQB } from "./queryBuilder.js";

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
    ordering,
  }: Pick<IndexingBuild, "buildId"> & {
    ordering: "omnichain" | "multichain";
  }): Promise<CrashRecoveryCheckpoint>;
  createIndexes(): Promise<void>;
  createTriggers(): Promise<void>;
  removeTriggers(): Promise<void>;
  /**
   * - "safe" checkpoint: The closest-to-tip finalized and completed checkpoint.
   * - "latest" checkpoint: The closest-to-tip completed checkpoint.
   *
   * @dev It is an invariant that every "latest" checkpoint is specific to that chain.
   * In other words, `chainId === latestCheckpoint.chainId`.
   */
  setCheckpoints: ({
    checkpoints,
  }: {
    checkpoints: {
      chainName: string;
      chainId: number;
      safeCheckpoint: string;
      latestCheckpoint: string;
    }[];
    db: QB;
  }) => Promise<void>;
  getCheckpoints: () => Promise<
    {
      chainName: string;
      chainId: number;
      safeCheckpoint: string;
      latestCheckpoint: string;
    }[]
  >;
  setReady(): Promise<void>;
  getReady(): Promise<boolean>;
  revert(args: {
    checkpoint: string;
    tx: QB;
  }): Promise<void>;
  finalize(args: { checkpoint: string; db: QB }): Promise<void>;
  commitBlock(args: { checkpoint: string; db: QB }): Promise<void>;
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

const VERSION = "3";

type PGliteDriver = { instance: PGlite };

type PostgresDriver = {
  admin: Pool;
  sync: Pool;
  user: Pool;
  readonly: Pool;
  listen: PoolClient | undefined;
};

export const getPonderMetaTable = (schema: string) => {
  if (schema === "public") {
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

export const getPonderCheckpointTable = (schema: string) => {
  if (schema === "public") {
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
      instance:
        dialect === "pglite"
          ? createPglite(preBuild.databaseConfig.options)
          : preBuild.databaseConfig.instance,
    };

    common.shutdown.add(async () => {
      clearInterval(heartbeatInterval);

      if (["start", "dev"].includes(common.options.command)) {
        await adminQB
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
      drizzlePglite((driver as PGliteDriver).instance, {
        casing: "snake_case",
        schema: PONDER_SYNC,
      }),
    );
    adminQB = createQB(
      drizzlePglite((driver as PGliteDriver).instance, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
    );
    userQB = createQB(
      drizzlePglite((driver as PGliteDriver).instance, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
    );
    readonlyQB = createQB(
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
      listen: undefined,
    } as PostgresDriver;

    await driver.admin.query(
      `CREATE SCHEMA IF NOT EXISTS "${namespace.schema}"`,
    );

    syncQB = createQB(
      drizzleNodePg(driver.sync, {
        casing: "snake_case",
        schema: PONDER_SYNC,
      }),
    );
    adminQB = createQB(
      drizzleNodePg(driver.admin, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
    );
    userQB = createQB(
      drizzleNodePg(driver.user, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
    );
    readonlyQB = createQB(
      drizzleNodePg(driver.readonly, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
    );

    common.shutdown.add(async () => {
      clearInterval(heartbeatInterval);

      if (["start", "dev"].includes(common.options.command)) {
        await adminQB
          .update(PONDER_META)
          .set({ value: sql`jsonb_set(value, '{is_locked}', to_jsonb(0))` });
      }

      const d = driver as PostgresDriver;
      d.listen?.release();
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

  const database = {
    driver,
    syncQB,
    adminQB,
    userQB,
    readonlyQB,
    async migrateSync() {
      const kysely = new Kysely({
        dialect:
          dialect === "postgres"
            ? new PostgresDialect({
                pool: (driver as PostgresDriver).admin,
              })
            : createPgliteKyselyDialect((driver as PGliteDriver).instance),
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "migrate",
            });
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

      const { error } = await migrator.migrateToLatest();
      if (error) throw error;
    },
    async migrate({ buildId }) {
      await userQB.execute(
        sql.raw(`
CREATE TABLE IF NOT EXISTS "${namespace.schema}"."_ponder_meta" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL
)`),
      );

      await userQB.execute(
        sql.raw(`
CREATE TABLE IF NOT EXISTS "${namespace.schema}"."_ponder_checkpoint" (
  "chain_name" TEXT PRIMARY KEY,
  "chain_id" BIGINT NOT NULL,
  "safe_checkpoint" VARCHAR(75) NOT NULL,
  "latest_checkpoint" VARCHAR(75) NOT NULL
)`),
      );

      await userQB.execute(
        `CREATE SEQUENCE IF NOT EXISTS "${namespace.schema}"."${SHARED_OPERATION_ID_SEQUENCE}" AS integer INCREMENT BY 1`,
      );

      const trigger = "status_trigger";
      const notification = "status_notify()";
      const channel = `${namespace.schema}_status_channel`;

      await userQB.execute(
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

      await userQB.execute(
        sql.raw(`
CREATE OR REPLACE TRIGGER "${trigger}"
AFTER INSERT OR UPDATE OR DELETE
ON "${namespace.schema}"._ponder_checkpoint
FOR EACH STATEMENT
EXECUTE PROCEDURE "${namespace.schema}".${notification};`),
      );

      const createTables = async (tx: QB) => {
        for (let i = 0; i < schemaBuild.statements.tables.sql.length; i++) {
          await tx
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
          await tx
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
        userQB.transaction(async (tx) => {
          // Note: All ponder versions are compatible with the next query (every version of the "_ponder_meta" table have the same columns)

          const previousApp = await tx
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

            await tx
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
              await tx.execute(
                sql.raw(
                  `DROP TABLE IF EXISTS "${namespace.schema}"."${table}" CASCADE`,
                ),
              );
              await tx.execute(
                sql.raw(
                  `DROP TABLE IF EXISTS "${namespace.schema}"."${sqlToReorgTableName(table)}" CASCADE`,
                ),
              );
            }
            for (const enumName of schemaBuild.statements.enums.json) {
              await tx.execute(
                sql.raw(
                  `DROP TYPE IF EXISTS "${namespace.schema}"."${enumName.name}"`,
                ),
              );
            }

            await tx.execute(
              sql.raw(
                `TRUNCATE TABLE "${namespace.schema}"."${getTableName(PONDER_CHECKPOINT)}" CASCADE`,
              ),
            );

            common.logger.info({
              service: "database",
              msg: `Created tables [${tables.map(getTableName).join(", ")}]`,
            });

            await tx.update(PONDER_META).set({ value: metadata });
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

          const checkpoints = await tx.select().from(PONDER_CHECKPOINT);
          const crashRecoveryCheckpoint =
            checkpoints.length === 0
              ? undefined
              : checkpoints.map((c) => ({
                  chainId: c.chainId,
                  checkpoint: c.safeCheckpoint,
                }));

          if (previousApp.is_ready === 0) {
            await tx.update(PONDER_META).set({ value: metadata });
            return { status: "success", crashRecoveryCheckpoint } as const;
          }

          // Remove triggers

          for (const table of tables) {
            await tx.execute(
              sql.raw(
                `DROP TRIGGER IF EXISTS "${getTableNames(table).trigger}" ON "${namespace.schema}"."${getTableName(table)}"`,
              ),
            );
          }

          // Remove indexes

          for (const indexStatement of schemaBuild.statements.indexes.json) {
            await tx.execute(
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

          await this.revert({ checkpoint: revertCheckpoint, tx });

          // Note: We don't update the `_ponder_checkpoint` table here, instead we wait for it to be updated
          // in the runtime script.

          await tx.update(PONDER_META).set({ value: metadata });
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

          await userQB.update(PONDER_META).set({
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
    async createIndexes() {
      for (const statement of schemaBuild.statements.indexes.sql) {
        await userQB.transaction(async (tx) => {
          await tx.execute("SET statement_timeout = 3600000;"); // 60 minutes
          await tx.execute(statement);
        });
      }
    },
    async createTriggers() {
      for (const table of tables) {
        const columns = getTableColumns(table);

        const columnNames = Object.values(columns).map(
          (column) => `"${getColumnCasing(column, "snake_case")}"`,
        );

        await userQB.execute(
          sql.raw(`
CREATE OR REPLACE FUNCTION "${namespace.schema}".${getTableNames(table).triggerFn}
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "${namespace.schema}"."${getTableName(getReorgTable(table))}" (${columnNames.join(",")}, operation, checkpoint)
    VALUES (${columnNames.map((name) => `NEW.${name}`).join(",")}, 0, '${MAX_CHECKPOINT_STRING}');
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO "${namespace.schema}"."${getTableName(getReorgTable(table))}" (${columnNames.join(",")}, operation, checkpoint)
    VALUES (${columnNames.map((name) => `OLD.${name}`).join(",")}, 1, '${MAX_CHECKPOINT_STRING}');
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO "${namespace.schema}"."${getTableName(getReorgTable(table))}" (${columnNames.join(",")}, operation, checkpoint)
    VALUES (${columnNames.map((name) => `OLD.${name}`).join(",")}, 2, '${MAX_CHECKPOINT_STRING}');
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql`),
        );

        await userQB.execute(
          sql.raw(`
CREATE OR REPLACE TRIGGER "${getTableNames(table).trigger}"
AFTER INSERT OR UPDATE OR DELETE ON "${namespace.schema}"."${getTableName(table)}"
FOR EACH ROW EXECUTE FUNCTION "${namespace.schema}".${getTableNames(table).triggerFn};
`),
        );
      }
    },
    async removeTriggers() {
      for (const table of tables) {
        await userQB.execute(
          sql.raw(
            `DROP TRIGGER IF EXISTS "${getTableNames(table).trigger}" ON "${namespace.schema}"."${getTableName(table)}"`,
          ),
        );
      }
    },
    async setCheckpoints({ checkpoints, db }) {
      if (checkpoints.length === 0) return;

      await db
        .insert(PONDER_CHECKPOINT)
        .values(checkpoints)
        .onConflictDoUpdate({
          target: PONDER_CHECKPOINT.chainName,
          set: {
            safeCheckpoint: sql`excluded.safe_checkpoint`,
            latestCheckpoint: sql`excluded.latest_checkpoint`,
          },
        });
    },
    getCheckpoints() {
      return userQB.select().from(PONDER_CHECKPOINT);
    },
    async setReady() {
      await userQB
        .update(PONDER_META)
        .set({ value: sql`jsonb_set(value, '{is_ready}', to_jsonb(1))` });
    },
    getReady() {
      return userQB
        .select()
        .from(PONDER_META)
        .then((result) => result[0]?.value.is_ready === 1 ?? false);
    },
    async revert({ checkpoint, tx }) {
      await Promise.all(
        tables.map(async (table) => {
          const primaryKeyColumns = getPrimaryKeyColumns(table);

          const result = await tx.execute(
            sql.raw(`
WITH reverted1 AS (
 DELETE FROM "${namespace.schema}"."${getTableName(getReorgTable(table))}"
  WHERE checkpoint > '${checkpoint}' RETURNING *
), reverted2 AS (
  SELECT ${primaryKeyColumns.map(({ sql }) => `"${sql}"`).join(", ")}, MIN(operation_id) AS operation_id FROM reverted1
  GROUP BY ${primaryKeyColumns.map(({ sql }) => `"${sql}"`).join(", ")}
), reverted3 AS (
  SELECT ${Object.values(getTableColumns(table))
    .map((column) => `reverted1."${getColumnCasing(column, "snake_case")}"`)
    .join(", ")}, reverted1.operation FROM reverted2
  INNER JOIN reverted1
  ON ${primaryKeyColumns.map(({ sql }) => `reverted2."${sql}" = reverted1."${sql}"`).join("AND ")}
  AND reverted2.operation_id = reverted1.operation_id
), inserted AS (
  DELETE FROM "${namespace.schema}"."${getTableName(table)}" as t
  WHERE EXISTS (
    SELECT * FROM reverted3
    WHERE ${primaryKeyColumns.map(({ sql }) => `t."${sql}" = reverted3."${sql}"`).join("AND ")}
    AND OPERATION = 0
  )
  RETURNING *
), updated_or_deleted AS (
  INSERT INTO  "${namespace.schema}"."${getTableName(table)}"
  SELECT ${Object.values(getTableColumns(table))
    .map((column) => `"${getColumnCasing(column, "snake_case")}"`)
    .join(", ")} FROM reverted3
  WHERE operation = 1 OR operation = 2
  ON CONFLICT (${primaryKeyColumns.map(({ sql }) => `"${sql}"`).join(", ")})
  DO UPDATE SET
    ${Object.values(getTableColumns(table))
      .map(
        (column) =>
          `"${getColumnCasing(column, "snake_case")}" = EXCLUDED."${getColumnCasing(column, "snake_case")}"`,
      )
      .join(", ")}
  RETURNING *
) SELECT COUNT(*) FROM reverted1 as count;
`),
          );

          common.logger.info({
            service: "database",
            // @ts-ignore
            msg: `Reverted ${result.rows[0]!.count} unfinalized operations from '${getTableName(table)}'`,
          });
        }),
      );
    },
    async finalize({ checkpoint, db }) {
      await Promise.all(
        tables.map((table) =>
          db
            .delete(getReorgTable(table))
            .where(lte(getReorgTable(table).checkpoint, checkpoint)),
        ),
      );

      const decoded = decodeCheckpoint(checkpoint);

      common.logger.debug({
        service: "database",
        msg: `Updated finalized checkpoint to (timestamp=${decoded.blockTimestamp} chainId=${decoded.chainId} block=${decoded.blockNumber})`,
      });
    },
    async commitBlock({ checkpoint, db }) {
      await Promise.all(
        tables.map(async (table) => {
          const reorgTable = getReorgTable(table);
          await db
            .update(reorgTable)
            .set({ checkpoint })
            .where(eq(reorgTable.checkpoint, MAX_CHECKPOINT_STRING));
        }),
      );
    },
  } satisfies Database;

  // @ts-ignore
  return database;
};
