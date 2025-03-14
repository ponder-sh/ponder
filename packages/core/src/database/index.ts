import { randomUUID } from "node:crypto";
import { getPrimaryKeyColumns, getTableNames } from "@/drizzle/index.js";
import { getColumnCasing, getReorgTable } from "@/drizzle/kit/index.js";
import type { Common } from "@/internal/common.js";
import { NonRetryableError, ShutdownError } from "@/internal/errors.js";
import type {
  IndexingBuild,
  NamespaceBuild,
  PreBuild,
  Schema,
  SchemaBuild,
  Status,
} from "@/internal/types.js";
import type { PonderSyncSchema } from "@/sync-store/encoding.js";
import {
  moveLegacyTables,
  migrationProvider as postgresMigrationProvider,
} from "@/sync-store/migrations.js";
import type { Drizzle } from "@/types/db.js";
import {
  MAX_CHECKPOINT_STRING,
  ZERO_CHECKPOINT_STRING,
  decodeCheckpoint,
} from "@/utils/checkpoint.js";
import { formatEta } from "@/utils/format.js";
import { createPool, createReadonlyPool } from "@/utils/pg.js";
import { createPglite, createPgliteKyselyDialect } from "@/utils/pglite.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import type { PGlite } from "@electric-sql/pglite";
import {
  type TableConfig,
  eq,
  getTableColumns,
  getTableName,
  is,
  lte,
  sql,
} from "drizzle-orm";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import {
  type PgQueryResultHKT,
  PgTable,
  type PgTableWithColumns,
  type PgTransaction,
  pgSchema,
  pgTable,
} from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import {
  Kysely,
  Migrator,
  PostgresDialect,
  WithSchemaPlugin,
  sql as ksql,
} from "kysely";
import type { Pool, PoolClient } from "pg";
import prometheus from "prom-client";

export type Database = {
  driver: PostgresDriver | PGliteDriver;
  qb: QueryBuilder;
  retry: <T>(fn: () => Promise<T>) => Promise<T>;
  record: <T>(
    options: { method: string; includeTraceLogs?: boolean },
    fn: () => Promise<T>,
  ) => Promise<T>;
  wrap: <T>(
    options: { method: string; includeTraceLogs?: boolean },
    fn: () => Promise<T>,
  ) => Promise<T>;
  transaction: <T>(
    fn: (client: PoolClient | PGlite, tx: Drizzle<Schema>) => Promise<T>,
  ) => Promise<T>;
  /** Migrate the `ponder_sync` schema. */
  migrateSync(): Promise<void>;
  /** Migrate the user schema. */
  migrate({ buildId }: Pick<IndexingBuild, "buildId">): Promise<void>;
  /** Determine the app checkpoint, possibly reverting unfinalized rows. */
  recoverCheckpoint(): Promise<string>;
  createIndexes(): Promise<void>;
  createTriggers(): Promise<void>;
  removeTriggers(): Promise<void>;
  getStatus: () => Promise<Status | null>;
  setStatus: (status: Status) => Promise<void>;
  revert(args: {
    checkpoint: string;
    tx: PgTransaction<PgQueryResultHKT, Schema>;
  }): Promise<void>;
  finalize(args: { checkpoint: string; db: Drizzle<Schema> }): Promise<void>;
  complete(args: { checkpoint: string; db: Drizzle<Schema> }): Promise<void>;
};

export type PonderApp = {
  is_locked: 0 | 1;
  is_dev: 0 | 1;
  heartbeat_at: number;
  build_id: string;
  checkpoint: string;
  table_names: string[];
  version: string;
};

const VERSION = "1";

type PGliteDriver = {
  instance: PGlite;
};

type PostgresDriver = {
  internal: Pool;
  user: Pool;
  sync: Pool;
  readonly: Pool;
  listen: PoolClient | undefined;
};

type QueryBuilder = {
  /** For migrating the user schema */
  migrate: Kysely<any>;
  /** Used to interact with the sync-store */
  sync: Kysely<PonderSyncSchema>;
  /** For interacting with the user schema (transform) */
  drizzle: Drizzle<Schema>;
  /** For interacting with the user schema (load) */
  drizzleReadonly: Drizzle<Schema>;
};

export const getPonderMeta = (namespace: NamespaceBuild) => {
  if (namespace === "public") {
    return pgTable("_ponder_meta", (t) => ({
      key: t.text().primaryKey().$type<"app">(),
      value: t.jsonb().$type<PonderApp>().notNull(),
    }));
  }

  return pgSchema(namespace).table("_ponder_meta", (t) => ({
    key: t.text().primaryKey().$type<"app">(),
    value: t.jsonb().$type<PonderApp>().notNull(),
  }));
};

export const getPonderStatus = (namespace: NamespaceBuild) => {
  if (namespace === "public") {
    return pgTable("_ponder_status", (t) => ({
      network_name: t.text().primaryKey(),
      block_number: t.bigint({ mode: "number" }),
      block_timestamp: t.bigint({ mode: "number" }),
      ready: t.boolean().notNull(),
    }));
  }

  return pgSchema(namespace).table("_ponder_status", (t) => ({
    network_name: t.text().primaryKey(),
    block_number: t.bigint({ mode: "number" }),
    block_timestamp: t.bigint({ mode: "number" }),
    ready: t.boolean().notNull(),
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

  const PONDER_META = getPonderMeta(namespace);
  const PONDER_STATUS = getPonderStatus(namespace);

  ////////
  // Create schema, drivers, roles, and query builders
  ////////

  let driver: PGliteDriver | PostgresDriver;
  let qb: Database["qb"];

  const dialect = preBuild.databaseConfig.kind;

  common.logger.info({
    service: "database",
    msg: `Using database schema '${namespace}'`,
  });

  if (dialect === "pglite" || dialect === "pglite_test") {
    driver = {
      instance:
        dialect === "pglite"
          ? createPglite(preBuild.databaseConfig.options)
          : preBuild.databaseConfig.instance,
    };

    common.shutdown.add(async () => {
      clearInterval(heartbeatInterval);

      await qb.drizzle
        .update(PONDER_META)
        .set({ value: sql`jsonb_set(value, '{is_locked}', to_jsonb(0))` })
        .where(eq(PONDER_META.key, "app"));

      if (dialect === "pglite") {
        await (driver as PGliteDriver).instance.close();
      }
    });

    const kyselyDialect = createPgliteKyselyDialect(driver.instance);

    await driver.instance.query(`CREATE SCHEMA IF NOT EXISTS "${namespace}"`);
    await driver.instance.query(`SET search_path TO "${namespace}"`);

    qb = {
      migrate: new Kysely({
        dialect: kyselyDialect,
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "migrate",
            });
          }
        },
        plugins: [new WithSchemaPlugin(namespace)],
      }),
      sync: new Kysely<PonderSyncSchema>({
        dialect: kyselyDialect,
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "sync",
            });
          }
        },
        plugins: [new WithSchemaPlugin("ponder_sync")],
      }),
      drizzle: drizzlePglite((driver as PGliteDriver).instance, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
      drizzleReadonly: drizzlePglite((driver as PGliteDriver).instance, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
    };
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
      internal: createPool(
        {
          ...preBuild.databaseConfig.poolConfig,
          application_name: `${namespace}_internal`,
          max: internalMax,
          statement_timeout: 10 * 60 * 1000, // 10 minutes to accommodate slow sync store migrations.
        },
        common.logger,
      ),
      user: createPool(
        {
          ...preBuild.databaseConfig.poolConfig,
          application_name: `${namespace}_user`,
          max: userMax,
        },
        common.logger,
      ),
      readonly: createReadonlyPool(
        {
          ...preBuild.databaseConfig.poolConfig,
          application_name: `${namespace}_readonly`,
          max: readonlyMax,
        },
        common.logger,
        namespace,
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

    await driver.internal.query(`CREATE SCHEMA IF NOT EXISTS "${namespace}"`);

    qb = {
      migrate: new Kysely({
        dialect: new PostgresDialect({ pool: driver.internal }),
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "migrate",
            });
          }
        },
        plugins: [new WithSchemaPlugin(namespace)],
      }),
      sync: new Kysely<PonderSyncSchema>({
        dialect: new PostgresDialect({ pool: driver.sync }),
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "sync",
            });
          }
        },
        plugins: [new WithSchemaPlugin("ponder_sync")],
      }),
      drizzle: drizzleNodePg(driver.user, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
      drizzleReadonly: drizzleNodePg(driver.readonly, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
    };

    common.shutdown.add(async () => {
      clearInterval(heartbeatInterval);

      await qb.drizzle
        .update(PONDER_META)
        .set({ value: sql`jsonb_set(value, '{is_locked}', to_jsonb(0))` })
        .where(eq(PONDER_META.key, "app"));

      const d = driver as PostgresDriver;
      d.listen?.release();
      await Promise.all([
        d.internal.end(),
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

    common.metrics.registry.removeSingleMetric(
      "ponder_postgres_query_queue_size",
    );
    common.metrics.ponder_postgres_query_queue_size = new prometheus.Gauge({
      name: "ponder_postgres_query_queue_size",
      help: "Number of queries waiting for an available connection",
      labelNames: ["pool"] as const,
      registers: [common.metrics.registry],
      collect() {
        this.set({ pool: "internal" }, d.internal.waitingCount);
        this.set({ pool: "sync" }, d.sync.waitingCount);
        this.set({ pool: "user" }, d.user.waitingCount);
        this.set({ pool: "readonly" }, d.readonly.waitingCount);
      },
    });
  }

  /** 'true' if `migrate` created new tables. */
  let createdTables: boolean;

  const tables = Object.values(schemaBuild.schema).filter(
    (table): table is PgTableWithColumns<TableConfig> => is(table, PgTable),
  );

  const database = {
    driver,
    qb,
    async retry(fn) {
      const RETRY_COUNT = 9;
      const BASE_DURATION = 125;

      // First error thrown is often the most useful
      let firstError: any;
      let hasError = false;

      for (let i = 0; i <= RETRY_COUNT; i++) {
        try {
          if (common.shutdown.isKilled) {
            throw new ShutdownError();
          }

          const result = await fn();

          if (common.shutdown.isKilled) {
            throw new ShutdownError();
          }
          return result;
        } catch (_error) {
          const error = _error as Error;

          if (common.shutdown.isKilled) {
            throw new ShutdownError();
          }

          if (!hasError) {
            hasError = true;
            firstError = error;
          }

          if (error instanceof NonRetryableError) {
            throw error;
          }

          if (i === RETRY_COUNT) {
            throw firstError;
          }

          const duration = BASE_DURATION * 2 ** i;

          await wait(duration);
        }
      }

      throw "unreachable";
    },
    async record(options, fn) {
      const endClock = startClock();

      const id = randomUUID().slice(0, 8);
      if (options.includeTraceLogs) {
        common.logger.trace({
          service: "database",
          msg: `Started '${options.method}' database method (id=${id})`,
        });
      }

      try {
        if (common.shutdown.isKilled) {
          throw new ShutdownError();
        }

        const result = await fn();
        common.metrics.ponder_database_method_duration.observe(
          { method: options.method },
          endClock(),
        );

        if (common.shutdown.isKilled) {
          throw new ShutdownError();
        }
        return result;
      } catch (_error) {
        const error = _error as Error;

        if (common.shutdown.isKilled) {
          throw new ShutdownError();
        }

        common.metrics.ponder_database_method_duration.observe(
          { method: options.method },
          endClock(),
        );
        common.metrics.ponder_database_method_error_total.inc({
          method: options.method,
        });

        common.logger.warn({
          service: "database",
          msg: `Failed '${options.method}' database method (id=${id})`,
          error,
        });

        throw error;
      } finally {
        if (options.includeTraceLogs) {
          common.logger.trace({
            service: "database",
            msg: `Completed '${options.method}' database method in ${Math.round(endClock())}ms (id=${id})`,
          });
        }
      }
    },
    async wrap(options, fn) {
      const RETRY_COUNT = 9;
      const BASE_DURATION = 125;

      // First error thrown is often the most useful
      let firstError: any;
      let hasError = false;

      for (let i = 0; i <= RETRY_COUNT; i++) {
        const endClock = startClock();

        const id = randomUUID().slice(0, 8);
        if (options.includeTraceLogs) {
          common.logger.trace({
            service: "database",
            msg: `Started '${options.method}' database method (id=${id})`,
          });
        }

        try {
          if (common.shutdown.isKilled) {
            throw new ShutdownError();
          }

          const result = await fn();
          common.metrics.ponder_database_method_duration.observe(
            { method: options.method },
            endClock(),
          );

          if (common.shutdown.isKilled) {
            throw new ShutdownError();
          }
          return result;
        } catch (_error) {
          const error = _error as Error;

          if (common.shutdown.isKilled) {
            throw new ShutdownError();
          }

          common.metrics.ponder_database_method_duration.observe(
            { method: options.method },
            endClock(),
          );
          common.metrics.ponder_database_method_error_total.inc({
            method: options.method,
          });

          if (!hasError) {
            hasError = true;
            firstError = error;
          }

          if (error instanceof NonRetryableError) {
            common.logger.warn({
              service: "database",
              msg: `Failed '${options.method}' database method (id=${id})`,
              error,
            });
            throw error;
          }

          if (i === RETRY_COUNT) {
            common.logger.warn({
              service: "database",
              msg: `Failed '${options.method}' database method after '${i + 1}' attempts (id=${id})`,
              error,
            });
            throw firstError;
          }

          const duration = BASE_DURATION * 2 ** i;
          common.logger.debug({
            service: "database",
            msg: `Failed '${options.method}' database method, retrying after ${duration} milliseconds (id=${id})`,
            error,
          });
          await wait(duration);
        } finally {
          if (options.includeTraceLogs) {
            common.logger.trace({
              service: "database",
              msg: `Completed '${options.method}' database method in ${Math.round(endClock())}ms (id=${id})`,
            });
          }
        }
      }

      throw "unreachable";
    },
    async transaction(fn) {
      if (dialect === "postgres") {
        const client = await (
          database.driver as { internal: Pool }
        ).internal.connect();
        try {
          await client.query("BEGIN");
          const tx = drizzleNodePg(client, {
            casing: "snake_case",
            schema: schemaBuild.schema,
          });
          const result = await fn(client, tx);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      } else {
        const client = (database.driver as { instance: PGlite }).instance;
        try {
          await client.query("BEGIN");
          const tx = drizzlePglite(client, {
            casing: "snake_case",
            schema: schemaBuild.schema,
          });
          const result = await fn(client, tx);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client?.query("ROLLBACK");
          throw error;
        }
      }
    },
    async migrateSync() {
      await this.wrap(
        { method: "migrateSyncStore", includeTraceLogs: true },
        async () => {
          // TODO: Probably remove this at 1.0 to speed up startup time.
          await moveLegacyTables({
            common: common,
            db: qb.migrate,
            newSchemaName: "ponder_sync",
          });

          const migrator = new Migrator({
            db: qb.sync as any,
            provider: postgresMigrationProvider,
            migrationTableSchema: "ponder_sync",
          });

          const { error } = await migrator.migrateToLatest();
          if (error) throw error;
        },
      );
    },
    async migrate({ buildId }) {
      ////////
      // Migrate
      ////////

      // v0.4 migration

      // v0.6 migration

      const hasPonderSchema = await qb.migrate
        // @ts-ignore
        .selectFrom("information_schema.schemata")
        // @ts-ignore
        .select("schema_name")
        // @ts-ignore
        .where("schema_name", "=", "ponder")
        .executeTakeFirst()
        .then((schema) => schema?.schema_name === "ponder");

      if (hasPonderSchema) {
        const hasNamespaceLockTable = await qb.migrate
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
          await this.wrap(
            { method: "migrate", includeTraceLogs: true },
            async () => {
              const namespaceCount = await qb.migrate
                .withSchema("ponder")
                // @ts-ignore
                .selectFrom("namespace_lock")
                .select(ksql`count(*)`.as("count"))
                .executeTakeFirst();

              const tableNames = await qb.migrate
                .withSchema("ponder")
                // @ts-ignore
                .selectFrom("namespace_lock")
                // @ts-ignore
                .select("schema")
                // @ts-ignore
                .where("namespace", "=", preBuild.namespace)
                .executeTakeFirst()
                .then((schema: any | undefined) =>
                  schema === undefined
                    ? undefined
                    : Object.keys(schema.schema.tables),
                );
              if (tableNames) {
                for (const tableName of tableNames) {
                  await qb.migrate.schema
                    .dropTable(tableName)
                    .ifExists()
                    .cascade()
                    .execute();
                }

                await qb.migrate
                  .withSchema("ponder")
                  // @ts-ignore
                  .deleteFrom("namespace_lock")
                  // @ts-ignore
                  .where("namespace", "=", preBuild.namespace)
                  .execute();

                if (namespaceCount!.count === 1) {
                  await qb.migrate.schema
                    .dropSchema("ponder")
                    .cascade()
                    .execute();

                  common.logger.debug({
                    service: "database",
                    msg: `Removed 'ponder' schema`,
                  });
                }
              }
            },
          );
        }
      }

      // v0.8 migration

      // If the schema previously ran with a 0.7 app, remove
      // all unlocked "dev" apps. Then, copy a _ponder_meta entry
      // to the new format if there is one remaining.

      const hasPonderMetaTable = await qb.migrate
        // @ts-ignore
        .selectFrom("information_schema.tables")
        // @ts-ignore
        .select(["table_name", "table_schema"])
        // @ts-ignore
        .where("table_name", "=", "_ponder_meta")
        // @ts-ignore
        .where("table_schema", "=", namespace)
        .executeTakeFirst()
        .then((table) => table !== undefined);

      if (hasPonderMetaTable) {
        await this.wrap({ method: "migrate", includeTraceLogs: true }, () =>
          qb.migrate.transaction().execute(async (tx) => {
            const previousApps = await tx
              .selectFrom("_ponder_meta")
              // @ts-ignore
              .where("key", "like", "app_%")
              .select("value")
              .execute()
              .then((rows) => rows.map(({ value }) => value as PonderApp));

            if (
              previousApps.some(
                (app) =>
                  app.is_locked === 1 &&
                  app.heartbeat_at + common.options.databaseHeartbeatTimeout >
                    Date.now(),
              )
            ) {
              throw new NonRetryableError(
                `Migration failed: Schema '${namespace}' has an active app`,
              );
            }

            for (const app of previousApps) {
              for (const table of app.table_names) {
                await tx.schema
                  // @ts-ignore
                  .dropTable(`${app.instance_id}__${table}`)
                  .cascade()
                  .ifExists()
                  .execute();
                await tx.schema
                  // @ts-ignore
                  .dropTable(`${app.instance_id}_reorg__${table}`)
                  .cascade()
                  .ifExists()
                  .execute();
              }
              await tx
                .deleteFrom("_ponder_meta")
                // @ts-ignore
                .where("key", "=", `status_${app.instance_id}`)
                .execute();
              await tx
                .deleteFrom("_ponder_meta")
                // @ts-ignore
                .where("key", "=", `app_${app.instance_id}`)
                .execute();
            }

            if (previousApps.length > 0) {
              common.logger.debug({
                service: "database",
                msg: "Migrated previous app to v0.8",
              });
            }
          }),
        );
      }

      // 0.9 migration

      if (hasPonderMetaTable) {
        await qb.migrate
          .deleteFrom("_ponder_meta")
          // @ts-ignore
          .where("key", "=", "status")
          .execute();

        const version: string | undefined = await qb.migrate
          .selectFrom("_ponder_meta")
          .select("value")
          .where("key", "=", "app")
          .executeTakeFirst()
          .then((row) => row?.value.version);

        if (version === undefined || Number(version) < Number(VERSION)) {
          await qb.migrate.schema
            .dropTable("_ponder_status")
            .ifExists()
            .cascade()
            .execute();
        }
      }

      await this.wrap(
        { method: "migrate", includeTraceLogs: true },
        async () => {
          await qb.drizzle.execute(
            sql.raw(`
CREATE TABLE IF NOT EXISTS "${namespace}"."_ponder_meta" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB
)`),
          );

          await qb.drizzle.execute(
            sql.raw(`
CREATE TABLE IF NOT EXISTS "${namespace}"."_ponder_status" (
  "network_name" TEXT PRIMARY KEY,
  "block_number" BIGINT,
  "block_timestamp" BIGINT,
  "ready" BOOLEAN NOT NULL
)`),
          );

          const trigger = "status_trigger";
          const notification = "status_notify()";
          const channel = `${namespace}_status_channel`;

          await qb.drizzle.execute(
            sql.raw(`
CREATE OR REPLACE FUNCTION "${namespace}".${notification}
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
NOTIFY "${channel}";
RETURN NULL;
END;
$$;`),
          );

          await qb.drizzle.execute(
            sql.raw(`
CREATE OR REPLACE TRIGGER "${trigger}"
AFTER INSERT OR UPDATE OR DELETE
ON "${namespace}"._ponder_status
FOR EACH STATEMENT
EXECUTE PROCEDURE "${namespace}".${notification};`),
          );
        },
      );

      const attempt = () =>
        this.wrap({ method: "migrate", includeTraceLogs: true }, () =>
          qb.drizzle.transaction(async (tx) => {
            const createTables = async () => {
              for (
                let i = 0;
                i < schemaBuild.statements.tables.sql.length;
                i++
              ) {
                await tx
                  .execute(sql.raw(schemaBuild.statements.tables.sql[i]!))
                  .catch((_error) => {
                    const error = _error as Error;
                    if (!error.message.includes("already exists")) throw error;
                    const e = new NonRetryableError(
                      `Unable to create table '${namespace}'.'${schemaBuild.statements.tables.json[i]!.tableName}' because a table with that name already exists.`,
                    );
                    e.stack = undefined;
                    throw e;
                  });
              }
            };

            const createEnums = async () => {
              for (
                let i = 0;
                i < schemaBuild.statements.enums.sql.length;
                i++
              ) {
                await tx
                  .execute(sql.raw(schemaBuild.statements.enums.sql[i]!))
                  .catch((_error) => {
                    const error = _error as Error;
                    if (!error.message.includes("already exists")) throw error;
                    const e = new NonRetryableError(
                      `Unable to create enum '${namespace}'.'${schemaBuild.statements.enums.json[i]!.name}' because an enum with that name already exists.`,
                    );
                    e.stack = undefined;
                    throw e;
                  });
              }
            };

            const previousApp = await tx
              .select({ value: PONDER_META.value })
              .from(PONDER_META)
              .where(eq(PONDER_META.key, "app"))
              .then((result) => result[0]?.value);

            createdTables = false;

            if (previousApp === undefined) {
              await createEnums();
              await createTables();
              createdTables = true;
            } else if (
              previousApp.is_dev === 1 ||
              (process.env.PONDER_EXPERIMENTAL_DB === "platform" &&
                previousApp.build_id !== buildId) ||
              (process.env.PONDER_EXPERIMENTAL_DB === "platform" &&
                previousApp.checkpoint === ZERO_CHECKPOINT_STRING)
            ) {
              for (const table of tables) {
                await tx.execute(
                  sql.raw(
                    `DROP TABLE IF EXISTS "${namespace}"."${getTableName(table)}" CASCADE`,
                  ),
                );
                await tx.execute(
                  sql.raw(
                    `DROP TABLE IF EXISTS "${namespace}"."${getTableName(getReorgTable(table))}" CASCADE`,
                  ),
                );
              }
              for (const enumName of schemaBuild.statements.enums.json) {
                await tx.execute(
                  sql.raw(
                    `DROP TYPE IF EXISTS "${namespace}"."${enumName.name}"`,
                  ),
                );
              }

              await tx.execute(
                sql.raw(
                  `TRUNCATE TABLE "${namespace}"."${getTableName(PONDER_STATUS)}" CASCADE`,
                ),
              );

              await createEnums();
              await createTables();
              createdTables = true;
            }

            if (createdTables) {
              common.logger.info({
                service: "database",
                msg: `Created tables [${tables.map(getTableName).join(", ")}]`,
              });

              // write metadata

              const newApp = {
                is_locked: 1,
                is_dev: common.options.command === "dev" ? 1 : 0,
                heartbeat_at: Date.now(),
                build_id: buildId,
                checkpoint: ZERO_CHECKPOINT_STRING,
                table_names: tables.map(getTableName),
                version: VERSION,
              } satisfies PonderApp;

              await tx
                .insert(PONDER_META)
                .values({ key: "app", value: newApp })
                .onConflictDoUpdate({
                  target: PONDER_META.key,
                  set: { value: newApp },
                });
            } else {
              // schema one of: crash recovery, locked, error

              if (
                common.options.command === "dev" ||
                previousApp!.build_id !== buildId
              ) {
                const error = new NonRetryableError(
                  `Schema '${namespace}' was previously used by a different Ponder app. Drop the schema first, or use a different schema. Read more: https://ponder.sh/docs/getting-started/database#database-schema`,
                );
                error.stack = undefined;
                throw error;
              }

              // locked

              const isAppUnlocked =
                previousApp!.is_locked === 0 ||
                previousApp!.heartbeat_at +
                  common.options.databaseHeartbeatTimeout <=
                  Date.now();

              if (isAppUnlocked === false) {
                return {
                  status: "locked",
                  expiry:
                    previousApp!.heartbeat_at +
                    common.options.databaseHeartbeatTimeout,
                } as const;
              }

              // crash recovery

              common.logger.info({
                service: "database",
                msg: `Detected crash recovery for build '${buildId}' in schema '${namespace}' last active ${formatEta(Date.now() - previousApp!.heartbeat_at)} ago`,
              });
            }

            await tx
              .update(PONDER_STATUS)
              .set({ block_number: null, block_timestamp: null, ready: false });

            return { status: "success" } as const;
          }),
        );

      let result = await attempt();
      if (result.status === "locked") {
        const duration = result.expiry - Date.now();
        common.logger.warn({
          service: "database",
          msg: `Schema '${namespace}' is locked by a different Ponder app`,
        });
        common.logger.warn({
          service: "database",
          msg: `Waiting ${formatEta(duration)} for lock on schema '${namespace} to expire...`,
        });

        await wait(duration);

        result = await attempt();
        if (result.status === "locked") {
          const error = new NonRetryableError(
            `Failed to acquire lock on schema '${namespace}'. A different Ponder app is actively using this schema.`,
          );
          error.stack = undefined;
          throw error;
        }
      }

      heartbeatInterval = setInterval(async () => {
        try {
          const heartbeat = Date.now();

          await qb.drizzle
            .update(PONDER_META)
            .set({
              value: sql`jsonb_set(value, '{heartbeat_at}', ${heartbeat})`,
            })
            .where(eq(PONDER_META.key, "app"));

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
    },
    async recoverCheckpoint() {
      // new tables are empty
      if (createdTables) return ZERO_CHECKPOINT_STRING;

      return this.wrap(
        { method: "recoverCheckpoint", includeTraceLogs: true },
        () =>
          qb.drizzle.transaction(async (tx) => {
            const app = await tx
              .select({ value: PONDER_META.value })
              .from(PONDER_META)
              .where(eq(PONDER_META.key, "app"))
              .then((result) => result[0]!.value);

            if (app.checkpoint === ZERO_CHECKPOINT_STRING) {
              for (const table of tables) {
                await tx.execute(
                  sql.raw(
                    `TRUNCATE TABLE "${namespace}"."${getTableName(table)}", "${namespace}"."${getTableName(getReorgTable(table))}" CASCADE`,
                  ),
                );
              }
            } else {
              // Update metadata

              app.is_locked = 1;
              app.is_dev = common.options.command === "dev" ? 1 : 0;

              await tx
                .update(PONDER_META)
                .set({ value: app })
                .where(eq(PONDER_META.key, "app"));

              // Remove triggers

              for (const table of tables) {
                await tx.execute(
                  sql.raw(
                    `DROP TRIGGER IF EXISTS "${getTableNames(table).trigger}" ON "${namespace}"."${getTableName(table)}"`,
                  ),
                );
              }

              // Remove indexes

              for (const indexStatement of schemaBuild.statements.indexes
                .json) {
                await tx.execute(
                  sql.raw(
                    `DROP INDEX IF EXISTS "${namespace}"."${indexStatement.data.name}"`,
                  ),
                );
                common.logger.info({
                  service: "database",
                  msg: `Dropped index '${indexStatement.data.name}' in schema '${namespace}'`,
                });
              }

              // Revert unfinalized data

              await this.revert({ checkpoint: app.checkpoint, tx });
            }

            return app.checkpoint;
          }),
      );
    },
    async createIndexes() {
      for (const statement of schemaBuild.statements.indexes.sql) {
        await qb.drizzle.execute(statement);
      }
    },
    async createTriggers() {
      await this.wrap(
        { method: "createTriggers", includeTraceLogs: true },
        async () => {
          for (const table of tables) {
            const columns = getTableColumns(table);

            const columnNames = Object.values(columns).map(
              (column) => `"${getColumnCasing(column, "snake_case")}"`,
            );

            await qb.drizzle.execute(
              sql.raw(`
CREATE OR REPLACE FUNCTION "${namespace}".${getTableNames(table).triggerFn}
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "${namespace}"."${getTableName(getReorgTable(table))}" (${columnNames.join(",")}, operation, checkpoint)
    VALUES (${columnNames.map((name) => `NEW.${name}`).join(",")}, 0, '${MAX_CHECKPOINT_STRING}');
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO "${namespace}"."${getTableName(getReorgTable(table))}" (${columnNames.join(",")}, operation, checkpoint)
    VALUES (${columnNames.map((name) => `OLD.${name}`).join(",")}, 1, '${MAX_CHECKPOINT_STRING}');
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO "${namespace}"."${getTableName(getReorgTable(table))}" (${columnNames.join(",")}, operation, checkpoint)
    VALUES (${columnNames.map((name) => `OLD.${name}`).join(",")}, 2, '${MAX_CHECKPOINT_STRING}');
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql`),
            );

            await qb.drizzle.execute(
              sql.raw(`
CREATE OR REPLACE TRIGGER "${getTableNames(table).trigger}"
AFTER INSERT OR UPDATE OR DELETE ON "${namespace}"."${getTableName(table)}"
FOR EACH ROW EXECUTE FUNCTION "${namespace}".${getTableNames(table).triggerFn};
`),
            );
          }
        },
      );
    },
    async removeTriggers() {
      await this.wrap(
        { method: "removeTriggers", includeTraceLogs: true },
        async () => {
          for (const table of tables) {
            await qb.drizzle.execute(
              sql.raw(
                `DROP TRIGGER IF EXISTS "${getTableNames(table).trigger}" ON "${namespace}"."${getTableName(table)}"`,
              ),
            );
          }
        },
      );
    },
    getStatus() {
      return this.wrap({ method: "getStatus" }, async () => {
        const result = await this.qb.drizzle.select().from(PONDER_STATUS);

        if (result.length === 0) {
          return null;
        }

        const status: Status = {};

        for (const row of result) {
          status[row.network_name] = {
            block:
              row.block_number && row.block_timestamp
                ? {
                    number: row.block_number,
                    timestamp: row.block_timestamp,
                  }
                : null,
            ready: row.ready,
          };
        }

        return status;
      });
    },
    setStatus(status) {
      return this.wrap({ method: "setStatus" }, async () => {
        await this.qb.drizzle
          .insert(PONDER_STATUS)
          .values(
            Object.entries(status).map(([networkName, value]) => ({
              network_name: networkName,
              block_number: value.block?.number,
              block_timestamp: value.block?.timestamp,
              ready: value.ready,
            })),
          )
          .onConflictDoUpdate({
            target: PONDER_STATUS.network_name,
            set: {
              block_number: sql`excluded.block_number`,
              block_timestamp: sql`excluded.block_timestamp`,
              ready: sql`excluded.ready`,
            },
          });
      });
    },
    async revert({ checkpoint, tx }) {
      await this.record({ method: "revert", includeTraceLogs: true }, () =>
        Promise.all(
          tables.map(async (table) => {
            const primaryKeyColumns = getPrimaryKeyColumns(table);

            const result = await tx.execute(
              sql.raw(`
WITH reverted1 AS (
  DELETE FROM "${namespace}"."${getTableName(getReorgTable(table))}"
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
  DELETE FROM "${namespace}"."${getTableName(table)}" as t
  WHERE EXISTS (
    SELECT * FROM reverted3
    WHERE ${primaryKeyColumns.map(({ sql }) => `t."${sql}" = reverted3."${sql}"`).join("AND ")}
    AND OPERATION = 0
  )
  RETURNING *
), updated_or_deleted AS (
  INSERT INTO  "${namespace}"."${getTableName(table)}"
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
        ),
      );
    },
    async finalize({ checkpoint, db }) {
      await this.record(
        { method: "finalize", includeTraceLogs: true },
        async () => {
          await db
            .update(PONDER_META)
            .set({
              value: sql`jsonb_set(value, '{checkpoint}', to_jsonb(${checkpoint}::varchar(75)))`,
            })
            .where(eq(PONDER_META.key, "app"));

          await Promise.all(
            tables.map((table) =>
              db
                .delete(getReorgTable(table))
                .where(lte(getReorgTable(table).checkpoint, checkpoint)),
            ),
          );
        },
      );

      const decoded = decodeCheckpoint(checkpoint);

      common.logger.debug({
        service: "database",
        msg: `Updated finalized checkpoint to (timestamp=${decoded.blockTimestamp} chainId=${decoded.chainId} block=${decoded.blockNumber})`,
      });
    },
    async complete({ checkpoint, db }) {
      await Promise.all(
        tables.map((table) =>
          this.wrap({ method: "complete" }, async () => {
            const reorgTable = getReorgTable(table);
            await db
              .update(reorgTable)
              .set({ checkpoint })
              .where(eq(reorgTable.checkpoint, MAX_CHECKPOINT_STRING));
          }),
        ),
      );
    },
  } satisfies Database;

  // @ts-ignore
  return database;
};
