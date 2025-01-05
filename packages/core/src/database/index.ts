import type { IndexingBuild, PreBuild, SchemaBuild } from "@/build/index.js";
import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import {
  type Drizzle,
  type Schema,
  getPrimaryKeyColumns,
  getTableNames,
} from "@/drizzle/index.js";
import { getColumnCasing } from "@/drizzle/kit/index.js";
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
import parse from "pg-connection-string";
import prometheus from "prom-client";
import { HeadlessKysely } from "./kysely.js";

export type Database = {
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
   * @returns The progress checkpoint that that app should start from.
   */
  prepareNamespace(args: Pick<IndexingBuild, "buildId">): Promise<{
    checkpoint: string;
  }>;
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
};

export type PonderInternalSchema = {
  _ponder_meta:
    | { key: "app"; value: PonderApp }
    | { key: "status"; value: Status | null };
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
};

type QueryBuilder = {
  /** For updating metadata and handling reorgs */
  internal: HeadlessKysely<PonderInternalSchema>;
  /** For indexing-store methods in user code */
  user: HeadlessKysely<any>;
  /** Used to interact with the sync-store */
  sync: HeadlessKysely<PonderSyncSchema>;
  /** Used in api functions */
  readonly: HeadlessKysely<unknown>;
  /** Used in client queries */
  // client: HeadlessKysely<unknown>;
  drizzle: Drizzle<Schema>;
  drizzleReadonly: Drizzle<Schema>;
};

export const createDatabase = async ({
  common,
  preBuild,
  schemaBuild,
}: {
  common: Common;
  preBuild: PreBuild;
  schemaBuild: Omit<SchemaBuild, "graphqlSchema">;
}): Promise<Database> => {
  let heartbeatInterval: NodeJS.Timeout | undefined;

  ////////
  // Create drivers and orms
  ////////

  let driver: PGliteDriver | PostgresDriver;
  let qb: Database["qb"];

  const dialect = preBuild.databaseConfig.kind;

  if (dialect === "pglite" || dialect === "pglite_test") {
    driver = {
      instance:
        dialect === "pglite"
          ? createPglite(preBuild.databaseConfig.options)
          : preBuild.databaseConfig.instance,
    };

    const kyselyDialect = new KyselyPGlite(driver.instance).dialect;

    await driver.instance.query(
      `CREATE SCHEMA IF NOT EXISTS "${preBuild.namespace}"`,
    );
    await driver.instance.query(`SET search_path TO "${preBuild.namespace}"`);

    qb = {
      internal: new HeadlessKysely({
        name: "internal",
        common,
        dialect: kyselyDialect,
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "internal",
            });
          }
        },
        plugins: [new WithSchemaPlugin(preBuild.namespace)],
      }),
      user: new HeadlessKysely({
        name: "user",
        common: common,
        dialect: kyselyDialect,
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "user",
            });
          }
        },
        plugins: [new WithSchemaPlugin(preBuild.namespace)],
      }),
      readonly: new HeadlessKysely({
        name: "readonly",
        common: common,
        dialect: kyselyDialect,
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "readonly",
            });
          }
        },
        plugins: [new WithSchemaPlugin(preBuild.namespace)],
      }),
      sync: new HeadlessKysely<PonderSyncSchema>({
        name: "sync",
        common: common,
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

    const internal = createPool(
      {
        ...preBuild.databaseConfig.poolConfig,
        application_name: `${preBuild.namespace}_internal`,
        max: internalMax,
        statement_timeout: 10 * 60 * 1000, // 10 minutes to accommodate slow sync store migrations.
      },
      common.logger,
    );

    const connection = (parse as unknown as typeof parse.parse)(
      preBuild.databaseConfig.poolConfig.connectionString!,
    );

    const role =
      connection.database === undefined
        ? `ponder_readonly_${preBuild.namespace}`
        : `ponder_readonly_${connection.database}_${preBuild.namespace}`;

    await internal.query(`CREATE SCHEMA IF NOT EXISTS "${preBuild.namespace}"`);
    const hasRole = await internal
      .query("SELECT FROM pg_roles WHERE rolname = $1", [role])
      .then(({ rows }) => rows[0]);
    if (hasRole) {
      await internal.query(`DROP OWNED BY "${role}"`);
      await internal.query(`DROP ROLE IF EXISTS "${role}"`);
    }
    await internal.query(`CREATE ROLE "${role}" WITH LOGIN PASSWORD 'pw'`);
    await internal.query(
      `GRANT CONNECT ON DATABASE "${connection.database}" TO "${role}"`,
    );
    await internal.query(
      `GRANT USAGE ON SCHEMA "${preBuild.namespace}" TO "${role}"`,
    );
    await internal.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA "${preBuild.namespace}" GRANT SELECT ON TABLES TO "${role}"`,
    );
    await internal.query(
      `ALTER ROLE "${role}" SET search_path TO "${preBuild.namespace}"`,
    );
    await internal.query(`ALTER ROLE "${role}" SET statement_timeout TO '1s'`);
    await internal.query(`ALTER ROLE "${role}" SET work_mem TO '1MB'`);

    driver = {
      internal,
      user: createPool(
        {
          ...preBuild.databaseConfig.poolConfig,
          application_name: `${preBuild.namespace}_user`,
          max: userMax,
        },
        common.logger,
      ),
      readonly: createPool(
        {
          ...preBuild.databaseConfig.poolConfig,
          connectionString: undefined,
          application_name: `${preBuild.namespace}_readonly`,
          max: readonlyMax,
          user: role,
          password: "pw",
          host: connection.host ?? undefined,
          port: Number(connection.port!),
          database: connection.database ?? undefined,
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
    };

    qb = {
      internal: new HeadlessKysely({
        name: "internal",
        common: common,
        dialect: new PostgresDialect({ pool: driver.internal }),
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "internal",
            });
          }
        },
        plugins: [new WithSchemaPlugin(preBuild.namespace)],
      }),
      user: new HeadlessKysely({
        name: "user",
        common: common,
        dialect: new PostgresDialect({ pool: driver.user }),
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "user",
            });
          }
        },
        plugins: [new WithSchemaPlugin(preBuild.namespace)],
      }),
      readonly: new HeadlessKysely({
        name: "readonly",
        common: common,
        dialect: new PostgresDialect({ pool: driver.readonly }),
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "readonly",
            });
          }
        },
        plugins: [new WithSchemaPlugin(preBuild.namespace)],
      }),
      sync: new HeadlessKysely<PonderSyncSchema>({
        name: "sync",
        common: common,
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
      drizzle: drizzleNodePg((driver as PostgresDriver).user, {
        casing: "snake_case",
        schema: schemaBuild.schema,
      }),
      drizzleReadonly: drizzleNodePg((driver as PostgresDriver).readonly, {
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

  const database = {
    qb,
    async migrateSync() {
      await qb.sync.wrap({ method: "migrateSyncStore" }, async () => {
        // TODO: Probably remove this at 1.0 to speed up startup time.
        // TODO(kevin) is the `WithSchemaPlugin` going to break this?
        await moveLegacyTables({
          common: common,
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
    async prepareNamespace({ buildId }) {
      common.logger.info({
        service: "database",
        msg: `Using database schema '${preBuild.namespace}'`,
      });

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
          });
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
        .where("table_schema", "=", preBuild.namespace)
        .executeTakeFirst()
        .then((table) => table !== undefined);

      if (hasPonderMetaTable) {
        await qb.internal.wrap({ method: "migrate" }, () =>
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
                `Migration failed: Schema '${preBuild.namespace}' has an active app`,
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

      await qb.internal.wrap({ method: "setup" }, async () => {
        // Create "_ponder_meta" table if it doesn't exist
        await qb.internal.schema
          .createTable("_ponder_meta")
          .addColumn("key", "text", (col) => col.primaryKey())
          .addColumn("value", "jsonb")
          .ifNotExists()
          .execute();
      });

      const attempt = () =>
        qb.internal.wrap({ method: "setup" }, () =>
          qb.internal.transaction().execute(async (tx) => {
            const previousApp = await tx
              .selectFrom("_ponder_meta")
              .where("key", "=", "app")
              .select("value")
              .executeTakeFirst()
              .then((row) => row?.value as PonderApp | undefined);

            const newApp = {
              is_locked: 1,
              is_dev: common.options.command === "dev" ? 1 : 0,
              heartbeat_at: Date.now(),
              build_id: buildId,
              checkpoint: encodeCheckpoint(zeroCheckpoint),
              table_names: getTableNames(schemaBuild.schema).map(
                (tableName) => tableName.sql,
              ),
            } satisfies PonderApp;

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
                      `Unable to create enum '${preBuild.namespace}'.'${schemaBuild.statements.enums.json[i]!.name}' because an enum with that name already exists.`,
                    );
                    e.stack = undefined;
                    throw e;
                  });
              }
            };

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
                      `Unable to create table '${preBuild.namespace}'.'${schemaBuild.statements.tables.json[i]!.tableName}' because a table with that name already exists.`,
                    );
                    e.stack = undefined;
                    throw e;
                  });
              }
            };

            const dropTables = async () => {
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
            };

            const dropEnums = async () => {
              for (const enumName of schemaBuild.statements.enums.json) {
                await tx.schema.dropType(enumName.name).ifExists().execute();
              }
            };

            // If schema is empty, create tables
            // If schema is empty, create tables
            if (previousApp === undefined) {
              await tx
                .insertInto("_ponder_meta")
                .values({ key: "status", value: null })
                .execute();
              await tx
                .insertInto("_ponder_meta")
                .values({
                  key: "app",
                  value: newApp,
                })
                .execute();

              await createEnums();
              await createTables();

              common.logger.info({
                service: "database",
                msg: `Created tables [${newApp.table_names.join(", ")}]`,
              });

              return {
                status: "success",
                checkpoint: encodeCheckpoint(zeroCheckpoint),
              } as const;
            }

            // dev fast path
            if (
              previousApp.is_dev === 1 ||
              (process.env.PONDER_EXPERIMENTAL_DB === "platform" &&
                previousApp.build_id !== newApp.build_id) ||
              (process.env.PONDER_EXPERIMENTAL_DB === "platform" &&
                previousApp.checkpoint === encodeCheckpoint(zeroCheckpoint))
            ) {
              await tx
                .updateTable("_ponder_meta")
                .set({ value: null })
                .where("key", "=", "status")
                .execute();
              await tx
                .updateTable("_ponder_meta")
                .set({ value: newApp })
                .where("key", "=", "app")
                .execute();

              await dropTables();
              await dropEnums();

              await createEnums();
              await createTables();

              common.logger.info({
                service: "database",
                msg: `Created tables [${newApp.table_names.join(", ")}]`,
              });

              return {
                status: "success",
                checkpoint: encodeCheckpoint(zeroCheckpoint),
              } as const;
            }

            // If crash recovery is not possible, error
            if (
              common.options.command === "dev" ||
              previousApp.build_id !== newApp.build_id
            ) {
              const error = new NonRetryableError(
                `Schema '${preBuild.namespace}' was previously used by a different Ponder app. Drop the schema first, or use a different schema. Read more: https://ponder.sh/docs/getting-started/database#database-schema`,
              );
              error.stack = undefined;
              throw error;
            }

            const isAppUnlocked =
              previousApp.is_locked === 0 ||
              previousApp.heartbeat_at +
                common.options.databaseHeartbeatTimeout <=
                Date.now();

            // If app is locked, wait
            if (isAppUnlocked === false) {
              return {
                status: "locked",
                expiry:
                  previousApp.heartbeat_at +
                  common.options.databaseHeartbeatTimeout,
              } as const;
            }

            // Crash recovery is possible, recover

            if (previousApp.checkpoint === encodeCheckpoint(zeroCheckpoint)) {
              await tx
                .updateTable("_ponder_meta")
                .set({ value: null })
                .where("key", "=", "status")
                .execute();
              await tx
                .updateTable("_ponder_meta")
                .set({ value: newApp })
                .where("key", "=", "app")
                .execute();

              await dropTables();
              await dropEnums();

              await createEnums();
              await createTables();

              common.logger.info({
                service: "database",
                msg: `Created tables [${newApp.table_names.join(", ")}]`,
              });

              return {
                status: "success",
                checkpoint: encodeCheckpoint(zeroCheckpoint),
              } as const;
            }

            const checkpoint = previousApp.checkpoint;
            newApp.checkpoint = checkpoint;

            await tx
              .updateTable("_ponder_meta")
              .set({ value: null })
              .where("key", "=", "status")
              .execute();
            await tx
              .updateTable("_ponder_meta")
              .set({ value: newApp })
              .where("key", "=", "app")
              .execute();

            common.logger.info({
              service: "database",
              msg: `Detected crash recovery for build '${buildId}' in schema '${preBuild.namespace}' last active ${formatEta(Date.now() - previousApp.heartbeat_at)} ago`,
            });

            // Remove triggers

            for (const tableName of getTableNames(schemaBuild.schema)) {
              await sql
                .raw(
                  `DROP TRIGGER IF EXISTS "${tableName.trigger}" ON "${preBuild.namespace}"."${tableName.sql}"`,
                )
                .execute(tx);
            }

            // Remove indexes

            for (const indexStatement of schemaBuild.statements.indexes.json) {
              await tx.schema
                .dropIndex(indexStatement.data.name)
                .ifExists()
                .execute();

              common.logger.info({
                service: "database",
                msg: `Dropped index '${indexStatement.data.name}' in schema '${preBuild.namespace}'`,
              });
            }

            // Revert unfinalized data

            const { blockTimestamp, chainId, blockNumber } =
              decodeCheckpoint(checkpoint);

            common.logger.info({
              service: "database",
              msg: `Reverting operations after finalized checkpoint (timestamp=${blockTimestamp} chainId=${chainId} block=${blockNumber})`,
            });

            for (const tableName of getTableNames(schemaBuild.schema)) {
              await revert({
                tableName,
                checkpoint,
                tx,
              });
            }

            return {
              status: "success",
              checkpoint,
            } as const;
          }),
        );

      let result = await attempt();
      if (result.status === "locked") {
        const duration = result.expiry - Date.now();
        common.logger.warn({
          service: "database",
          msg: `Schema '${preBuild.namespace}' is locked by a different Ponder app`,
        });
        common.logger.warn({
          service: "database",
          msg: `Waiting ${formatEta(duration)} for lock on schema '${preBuild.namespace} to expire...`,
        });

        await wait(duration);

        result = await attempt();
        if (result.status === "locked") {
          const error = new NonRetryableError(
            `Failed to acquire lock on schema '${preBuild.namespace}'. A different Ponder app is actively using this schema.`,
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

          common.logger.debug({
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

      return { checkpoint: result.checkpoint };
    },
    async createIndexes() {
      for (const statement of schemaBuild.statements.indexes.sql) {
        await sql.raw(statement).execute(qb.internal);
      }
    },
    async createTriggers() {
      await qb.internal.wrap({ method: "createTriggers" }, async () => {
        for (const tableName of getTableNames(schemaBuild.schema)) {
          const columns = getTableColumns(
            schemaBuild.schema[tableName.js]! as PgTable,
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
    INSERT INTO "${preBuild.namespace}"."${tableName.reorg}" (${columnNames.join(",")}, operation, checkpoint)
    VALUES (${columnNames.map((name) => `NEW.${name}`).join(",")}, 0, '${encodeCheckpoint(maxCheckpoint)}');
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO "${preBuild.namespace}"."${tableName.reorg}" (${columnNames.join(",")}, operation, checkpoint)
    VALUES (${columnNames.map((name) => `OLD.${name}`).join(",")}, 1, '${encodeCheckpoint(maxCheckpoint)}');
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO "${preBuild.namespace}"."${tableName.reorg}" (${columnNames.join(",")}, operation, checkpoint)
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
          AFTER INSERT OR UPDATE OR DELETE ON "${preBuild.namespace}"."${tableName.sql}"
          FOR EACH ROW EXECUTE FUNCTION ${tableName.triggerFn};
          `)
            .execute(qb.internal);
        }
      });
    },
    async removeTriggers() {
      await qb.internal.wrap({ method: "removeTriggers" }, async () => {
        for (const tableName of getTableNames(schemaBuild.schema)) {
          await sql
            .raw(
              `DROP TRIGGER IF EXISTS "${tableName.trigger}" ON "${preBuild.namespace}"."${tableName.sql}"`,
            )
            .execute(qb.internal);
        }
      });
    },
    async revert({ checkpoint }) {
      await qb.internal.wrap({ method: "revert" }, () =>
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
      await qb.internal.wrap({ method: "finalize" }, async () => {
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
      });

      const decoded = decodeCheckpoint(checkpoint);

      common.logger.debug({
        service: "database",
        msg: `Updated finalized checkpoint to (timestamp=${decoded.blockTimestamp} chainId=${decoded.chainId} block=${decoded.blockNumber})`,
      });
    },
    async complete({ checkpoint }) {
      await Promise.all(
        getTableNames(schemaBuild.schema).map((tableName) =>
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
          .where("key", "=", "app")
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

      common.logger.debug({
        service: "database",
        msg: "Closed connection to database",
      });
    },
  } satisfies Database;

  return database;
};
