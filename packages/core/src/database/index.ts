import { getPrimaryKeyColumns, getTableNames } from "@/drizzle/index.js";
import { getColumnCasing } from "@/drizzle/kit/index.js";
import type { Common } from "@/internal/common.js";
import { IgnorableError, NonRetryableError } from "@/internal/errors.js";
import type {
  IndexingBuild,
  NamespaceBuild,
  PreBuild,
  Schema,
  SchemaBuild,
} from "@/internal/types.js";
import type { PonderSyncSchema } from "@/sync-store/encoding.js";
import {
  moveLegacyTables,
  migrationProvider as postgresMigrationProvider,
} from "@/sync-store/migrations.js";
import type { Drizzle } from "@/types/db.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { formatEta } from "@/utils/format.js";
import { createPool } from "@/utils/pg.js";
import { createPglite } from "@/utils/pglite.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import type { PGlite } from "@electric-sql/pglite";
import { getTableColumns } from "drizzle-orm";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import {
  Kysely,
  Migrator,
  PostgresDialect,
  type Transaction,
  WithSchemaPlugin,
  sql,
} from "kysely";
import { KyselyPGlite } from "kysely-pglite";
import type { Pool, PoolClient } from "pg";
import prometheus from "prom-client";

export type Database = {
  driver: PostgresDriver | PGliteDriver;
  qb: QueryBuilder;
  wrap: <T>(
    options: { method: string; includeTraceLogs?: boolean },
    fn: () => Promise<T>,
  ) => Promise<T>;
  /** Migrate the `ponder_sync` schema. */
  migrateSync(): Promise<void>;
  /** Migrate the user schema. */
  migrate({ buildId }: Pick<IndexingBuild, "buildId">): Promise<void>;
  /** Determine the app checkpoint , possibly reverting unfinalized rows. */
  recoverCheckpoint(): Promise<string>;
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
  build_id: string;
  checkpoint: string;
  table_names: string[];
  version: string;
};

const VERSION = "1";

export type PonderInternalSchema = {
  _ponder_meta: { key: "app"; value: PonderApp };
  _ponder_status: {
    network_name: string;
    block_number: number | null;
    block_timestamp: number | null;
    ready: boolean;
  };
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
  sync: Pool;
  readonly: Pool;
  listen: PoolClient | undefined;
};

type QueryBuilder = {
  /** For updating metadata and handling reorgs */
  internal: Kysely<PonderInternalSchema>;
  /** For indexing-store methods in user code */
  user: Kysely<any>;
  /** Used to interact with the sync-store */
  sync: Kysely<PonderSyncSchema>;
  /** Used in api functions */
  readonly: Kysely<any>;
  drizzle: Drizzle<Schema>;
  drizzleReadonly: Drizzle<Schema>;
};

export const createDatabase = async ({
  common,
  namespace,
  preBuild,
  schemaBuild,
}: {
  common: Common;
  namespace: NamespaceBuild;
  preBuild: PreBuild;
  schemaBuild: Omit<SchemaBuild, "graphqlSchema">;
}): Promise<Database> => {
  let heartbeatInterval: NodeJS.Timeout | undefined;
  let isKilled = false;

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

    const kyselyDialect = new KyselyPGlite(driver.instance).dialect;

    await driver.instance.query(`CREATE SCHEMA IF NOT EXISTS "${namespace}"`);
    await driver.instance.query(`SET search_path TO "${namespace}"`);

    qb = {
      internal: new Kysely({
        dialect: kyselyDialect,
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "internal",
            });
          }
        },
        plugins: [new WithSchemaPlugin(namespace)],
      }),
      user: new Kysely({
        dialect: kyselyDialect,
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "user",
            });
          }
        },
        plugins: [new WithSchemaPlugin(namespace)],
      }),
      readonly: new Kysely({
        dialect: kyselyDialect,
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "readonly",
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
      readonly: createPool(
        {
          ...preBuild.databaseConfig.poolConfig,
          application_name: `${namespace}_readonly`,
          max: readonlyMax,
        },
        common.logger,
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
      internal: new Kysely({
        dialect: new PostgresDialect({ pool: driver.internal }),
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "internal",
            });
          }
        },
        plugins: [new WithSchemaPlugin(namespace)],
      }),
      user: new Kysely({
        dialect: new PostgresDialect({ pool: driver.user }),
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "user",
            });
          }
        },
        plugins: [new WithSchemaPlugin(namespace)],
      }),
      readonly: new Kysely({
        dialect: new PostgresDialect({ pool: driver.readonly }),
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "readonly",
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
  }) => {
    const primaryKeyColumns = getPrimaryKeyColumns(
      schemaBuild.schema[tableName.js] as PgTable,
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

    common.logger.info({
      service: "database",
      msg: `Reverted ${rows.length} unfinalized operations from '${tableName.sql}' table`,
    });
  };

  let checkpoint: string | undefined;

  const database = {
    driver,
    qb,
    // @ts-ignore
    async wrap(options, fn) {
      const RETRY_COUNT = 9;
      const BASE_DURATION = 125;

      // First error thrown is often the most useful
      let firstError: any;
      let hasError = false;

      for (let i = 0; i <= RETRY_COUNT; i++) {
        const endClock = startClock();

        const id = crypto.randomUUID().slice(0, 8);
        if (options.includeTraceLogs) {
          common.logger.trace({
            service: "database",
            msg: `Started '${options.method}' database method (id=${id})`,
          });
        }

        try {
          const result = await fn();
          common.metrics.ponder_database_method_duration.observe(
            { method: options.method },
            endClock(),
          );
          return result;
        } catch (_error) {
          const error = _error as Error;

          common.metrics.ponder_database_method_duration.observe(
            { method: options.method },
            endClock(),
          );
          common.metrics.ponder_database_method_error_total.inc({
            method: options.method,
          });

          if (isKilled) {
            common.logger.trace({
              service: "database",
              msg: `Ignored error during '${options.method}' database method, service is killed (id=${id})`,
            });
            throw new IgnorableError();
          }

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
    },
    async migrateSync() {
      await this.wrap(
        { method: "migrateSyncStore", includeTraceLogs: true },
        async () => {
          // TODO: Probably remove this at 1.0 to speed up startup time.
          await moveLegacyTables({
            common: common,
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
        },
      );
    },
    async migrate({ buildId }) {
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
          await this.wrap(
            { method: "migrate", includeTraceLogs: true },
            async () => {
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
                .where("namespace", "=", preBuild.namespace)
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
                  .where("namespace", "=", preBuild.namespace)
                  .execute();

                if (namespaceCount!.count === 1) {
                  await qb.internal.schema
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

      const hasPonderMetaTable = await qb.internal
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
          qb.internal.transaction().execute(async (tx) => {
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
        await qb.internal
          .deleteFrom("_ponder_meta")
          // @ts-ignore
          .where("key", "=", "status")
          .execute();

        const version: string | undefined = await qb.internal
          .selectFrom("_ponder_meta")
          .select("value")
          .where("key", "=", "app")
          .executeTakeFirst()
          .then((row) => row?.value.version);

        if (version === undefined || Number(version) < Number(VERSION)) {
          await qb.internal.schema
            .dropTable("_ponder_status")
            .ifExists()
            .cascade()
            .execute();
        }
      }

      await this.wrap(
        { method: "migrate", includeTraceLogs: true },
        async () => {
          await qb.internal.schema
            .createTable("_ponder_meta")
            .addColumn("key", "text", (col) => col.primaryKey())
            .addColumn("value", "jsonb")
            .ifNotExists()
            .execute();

          await qb.internal.schema
            .createTable("_ponder_status")
            .addColumn("network_name", "text", (col) => col.primaryKey())
            .addColumn("block_number", "bigint")
            .addColumn("block_timestamp", "bigint")
            .addColumn("ready", "boolean", (col) => col.notNull())
            .ifNotExists()
            .execute();

          const trigger = "status_trigger";
          const notification = "status_notify()";
          const channel = `${namespace}_status_channel`;

          await sql
            .raw(`
        CREATE OR REPLACE FUNCTION "${namespace}".${notification}
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        BEGIN
        NOTIFY "${channel}";
        RETURN NULL;
        END;
        $$;`)
            .execute(qb.internal);

          await sql
            .raw(`
          CREATE OR REPLACE TRIGGER "${trigger}"
          AFTER INSERT OR UPDATE OR DELETE
          ON "${namespace}"._ponder_status
          FOR EACH STATEMENT
          EXECUTE PROCEDURE "${namespace}".${notification};`)
            .execute(qb.internal);
        },
      );

      const attempt = () =>
        this.wrap({ method: "migrate", includeTraceLogs: true }, () =>
          qb.internal.transaction().execute(async (tx) => {
            const createTables = async () => {
              for (
                let i = 0;
                i < schemaBuild.statements.tables.sql.length;
                i++
              ) {
                await sql
                  .raw(schemaBuild.statements.tables.sql[i]!)
                  .execute(tx)
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
                await sql
                  .raw(schemaBuild.statements.enums.sql[i]!)
                  .execute(tx)
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
              .selectFrom("_ponder_meta")
              .where("key", "=", "app")
              .select("value")
              .executeTakeFirst()
              .then((row) => row?.value);

            let createdTables = false;

            if (previousApp === undefined) {
              await createEnums();
              await createTables();
              createdTables = true;
            } else if (
              previousApp.is_dev === 1 ||
              (process.env.PONDER_EXPERIMENTAL_DB === "platform" &&
                previousApp.build_id !== buildId) ||
              (process.env.PONDER_EXPERIMENTAL_DB === "platform" &&
                previousApp.checkpoint === encodeCheckpoint(zeroCheckpoint))
            ) {
              for (const tableName of getTableNames(schemaBuild.schema)) {
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
              for (const enumName of schemaBuild.statements.enums.json) {
                await tx.schema.dropType(enumName.name).ifExists().execute();
              }

              await sql
                .raw(`TRUNCATE TABLE "${namespace}"."_ponder_status" CASCADE`)
                .execute(tx);

              await createEnums();
              await createTables();
              createdTables = true;
            }

            if (createdTables) {
              common.logger.info({
                service: "database",
                msg: `Created tables [${getTableNames(schemaBuild.schema)
                  .map(({ sql }) => sql)
                  .join(", ")}]`,
              });

              // write metadata

              checkpoint = encodeCheckpoint(zeroCheckpoint);

              const newApp = {
                is_locked: 1,
                is_dev: common.options.command === "dev" ? 1 : 0,
                heartbeat_at: Date.now(),
                build_id: buildId,
                checkpoint: encodeCheckpoint(zeroCheckpoint),
                table_names: getTableNames(schemaBuild.schema).map(
                  ({ sql }) => sql,
                ),
                version: VERSION,
              } satisfies PonderApp;

              await tx
                .insertInto("_ponder_meta")
                .values({ key: "app", value: newApp })
                .onConflict((oc) =>
                  oc
                    .column("key")
                    // @ts-ignore
                    .doUpdateSet({ value: newApp }),
                )
                .execute();
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
              .updateTable("_ponder_status")
              .set({ block_number: null, block_timestamp: null, ready: false })
              .execute();

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

          await qb.internal
            .updateTable("_ponder_meta")
            .where("key", "=", "app")
            .set({
              value: sql`jsonb_set(value, '{heartbeat_at}', ${heartbeat})`,
            })
            .execute();

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
      if (checkpoint !== undefined) {
        return checkpoint;
      }

      return this.wrap(
        { method: "recoverCheckpoint", includeTraceLogs: true },
        () =>
          qb.internal.transaction().execute(async (tx) => {
            const app = await tx
              .selectFrom("_ponder_meta")
              .where("key", "=", "app")
              .select("value")
              .executeTakeFirstOrThrow()
              .then((row) => row.value);

            if (app.checkpoint === encodeCheckpoint(zeroCheckpoint)) {
              for (const tableName of getTableNames(schemaBuild.schema)) {
                await sql
                  .raw(
                    `TRUNCATE TABLE "${namespace}"."${tableName.sql}", "${namespace}"."${tableName.reorg}" CASCADE`,
                  )
                  .execute(tx);
              }
            } else {
              // Update metadata

              app.is_locked = 1;
              app.is_dev = common.options.command === "dev" ? 1 : 0;

              await tx
                .updateTable("_ponder_meta")
                .set({ value: app })

                .where("key", "=", "app")
                .execute();

              // Remove triggers

              for (const tableName of getTableNames(schemaBuild.schema)) {
                await sql
                  .raw(
                    `DROP TRIGGER IF EXISTS "${tableName.trigger}" ON "${namespace}"."${tableName.sql}"`,
                  )
                  .execute(tx);
              }

              // Remove indexes

              for (const indexStatement of schemaBuild.statements.indexes
                .json) {
                await tx.schema
                  .dropIndex(indexStatement.data.name)
                  .ifExists()
                  .execute();
                common.logger.info({
                  service: "database",
                  msg: `Dropped index '${indexStatement.data.name}' in schema '${namespace}'`,
                });
              }

              // Revert unfinalized data

              for (const tableName of getTableNames(schemaBuild.schema)) {
                await revert({ tableName, checkpoint: app.checkpoint, tx });
              }
            }

            return app.checkpoint;
          }),
      );
    },
    async createIndexes() {
      for (const statement of schemaBuild.statements.indexes.sql) {
        await sql.raw(statement).execute(qb.internal);
      }
    },
    async createTriggers() {
      await this.wrap(
        { method: "createTriggers", includeTraceLogs: true },
        async () => {
          for (const tableName of getTableNames(schemaBuild.schema)) {
            const columns = getTableColumns(
              schemaBuild.schema[tableName.js]! as PgTable,
            );

            const columnNames = Object.values(columns).map(
              (column) => `"${getColumnCasing(column, "snake_case")}"`,
            );

            await sql
              .raw(`
CREATE OR REPLACE FUNCTION "${namespace}".${tableName.triggerFn}
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "${namespace}"."${tableName.reorg}" (${columnNames.join(",")}, operation, checkpoint)
    VALUES (${columnNames.map((name) => `NEW.${name}`).join(",")}, 0, '${encodeCheckpoint(maxCheckpoint)}');
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO "${namespace}"."${tableName.reorg}" (${columnNames.join(",")}, operation, checkpoint)
    VALUES (${columnNames.map((name) => `OLD.${name}`).join(",")}, 1, '${encodeCheckpoint(maxCheckpoint)}');
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO "${namespace}"."${tableName.reorg}" (${columnNames.join(",")}, operation, checkpoint)
    VALUES (${columnNames.map((name) => `OLD.${name}`).join(",")}, 2, '${encodeCheckpoint(maxCheckpoint)}');
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql
`)
              .execute(qb.internal);

            await sql
              .raw(`
          CREATE OR REPLACE TRIGGER "${tableName.trigger}"
          AFTER INSERT OR UPDATE OR DELETE ON "${namespace}"."${tableName.sql}"
          FOR EACH ROW EXECUTE FUNCTION "${namespace}".${tableName.triggerFn};
          `)
              .execute(qb.internal);
          }
        },
      );
    },
    async removeTriggers() {
      await this.wrap(
        { method: "removeTriggers", includeTraceLogs: true },
        async () => {
          for (const tableName of getTableNames(schemaBuild.schema)) {
            await sql
              .raw(
                `DROP TRIGGER IF EXISTS "${tableName.trigger}" ON "${namespace}"."${tableName.sql}"`,
              )
              .execute(qb.internal);
          }
        },
      );
    },
    async revert({ checkpoint }) {
      await this.wrap({ method: "revert", includeTraceLogs: true }, () =>
        Promise.all(
          getTableNames(schemaBuild.schema).map((tableName) =>
            qb.internal.transaction().execute((tx) =>
              revert({
                tableName,
                checkpoint,
                tx,
              }),
            ),
          ),
        ),
      );
    },
    async finalize({ checkpoint }) {
      await this.wrap(
        { method: "finalize", includeTraceLogs: true },
        async () => {
          await qb.internal
            .updateTable("_ponder_meta")
            .where("key", "=", "app")
            .set({
              value: sql`jsonb_set(value, '{checkpoint}', to_jsonb(${checkpoint}::varchar(75)))`,
            })
            .execute();

          await Promise.all(
            getTableNames(schemaBuild.schema).map((tableName) =>
              qb.internal
                .deleteFrom(tableName.reorg)
                .where("checkpoint", "<=", checkpoint)
                .execute(),
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
    async complete({ checkpoint }) {
      await Promise.all(
        getTableNames(schemaBuild.schema).map((tableName) =>
          this.wrap(
            { method: "complete", includeTraceLogs: true },
            async () => {
              await qb.internal
                .updateTable(tableName.reorg)
                .set({ checkpoint })
                .where("checkpoint", "=", encodeCheckpoint(maxCheckpoint))
                .execute();
            },
          ),
        ),
      );
    },
    async unlock() {
      clearInterval(heartbeatInterval);

      await this.wrap(
        { method: "unlock", includeTraceLogs: true },
        async () => {
          await qb.internal
            .updateTable("_ponder_meta")
            .where("key", "=", "app")
            .set({
              value: sql`jsonb_set(value, '{is_locked}', to_jsonb(0))`,
            })
            .execute();
        },
      );
    },
    async kill() {
      isKilled = true;

      if (dialect === "pglite") {
        const d = driver as PGliteDriver;
        await d.instance.close();
      }

      if (dialect === "pglite_test") {
        // no-op, allow test harness to clean up the instance
      }

      if (dialect === "postgres") {
        const d = driver as PostgresDriver;
        d.listen?.release();
        await d.internal.end();
        await d.user.end();
        await d.readonly.end();
        await d.sync.end();
      }

      common.logger.debug({
        service: "database",
        msg: "Closed connection to database",
      });
    },
  } satisfies Database;

  // @ts-ignore
  return database;
};
