import fs from "node:fs";
import {
  eq,
  getTableName,
  getViewName,
  inArray,
  isTable,
  isView,
  sql,
} from "drizzle-orm";
import { Clock, Effect, type Scope } from "effect";
import { hexToBigInt, hexToNumber } from "viem";
import {
  getLiveQueryNotifyProcedureName,
  getLiveQueryProcedureName,
  getPartitionName,
  getReorgSequenceName,
  getReorgTableName,
} from "../drizzle/onchain.js";
import { MigrationError, UniqueConstraintError } from "../internal/errors.js";
import { Options } from "../internal/options.js";
import type {
  CrashRecoveryCheckpoint,
  IndexingBuild,
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
} from "../internal/types.js";
import { eth_getBlockByNumber } from "../rpc/actions.js";
import * as PONDER_SYNC from "../sync-store/schema.js";
import { decodeCheckpoint } from "../utils/checkpoint.js";
import { getFinalizedBlock } from "../utils/finality.js";
import { formatEta } from "../utils/format.js";
import { startClockEffect } from "../utils/timer.js";
import {
  crashRecovery,
  createLiveQueryProcedures,
  dropLiveQueryTriggers,
  dropTriggers,
} from "./actions.js";
import {
  builder,
  type DbClient,
  type DbTransaction,
  rawSql,
  type Statement,
} from "./db.js";
import {
  getPonderCheckpointTable,
  getPonderMetaTable,
  LEGACY_MIGRATIONS,
  PONDER_CHECKPOINT_TABLE_NAME,
  PONDER_META_TABLE_NAME,
  type PonderApp6,
  SCHEMATA,
  VERSION,
} from "./index.js";

const readStatements = (schema: string, file: string) =>
  fs
    .readFileSync(
      new URL(`../sync-store/sql/${schema}/${file}`, import.meta.url),
      "utf-8",
    )
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

/**
 * Migrate the `ponder_sync` schema to the latest version.
 *
 * @dev Each version migrates in its own transaction, so a failed migration
 * continues from the last version that completed.
 */
export const migrateSync = (db: DbClient): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const context = { logAnnotations: { action: "migrate_sync" } };

    const dbSchemas = (yield* db.run(
      builder
        .select()
        .from(SCHEMATA)
        .where(
          inArray(SCHEMATA.schemaName, [...PONDER_SYNC.PONDER_SYNC_SCHEMAS]),
        ),
      { label: "migrate_sync", ...context },
    )).map((row) => row.schemaName);

    if (dbSchemas.includes("ponder_sync")) {
      const migrations = yield* db.run(
        builder.select().from(LEGACY_MIGRATIONS),
        context,
      );
      if (
        migrations.some(
          (migration) => migration.name === "2025_02_26_1_rpc_request_results",
        ) === false
      ) {
        return yield* Effect.fail(
          new MigrationError(
            '"ponder_sync" migration failed. Please first update to v0.10 or "DROP SCHEMA ponder_sync CASCADE".',
          ),
        );
      }
    }

    // Note: Run the migrations after the latest existing schema. A new
    // database only creates the latest schema, and does not copy data.
    let latestIndex = -1;
    for (let i = 0; i < PONDER_SYNC.PONDER_SYNC_SCHEMAS.length; i++) {
      if (dbSchemas.includes(PONDER_SYNC.PONDER_SYNC_SCHEMAS[i]!)) {
        latestIndex = i;
      }
    }
    const isNewDatabase = latestIndex === -1;
    const schemasToMigrate = isNewDatabase
      ? [PONDER_SYNC.PONDER_SYNC_SCHEMA]
      : PONDER_SYNC.PONDER_SYNC_SCHEMAS.slice(latestIndex + 1);

    for (const schema of schemasToMigrate) {
      const endClock = yield* startClockEffect;
      const statements = (
        isNewDatabase ? ["create.sql"] : ["create.sql", "copy.sql"]
      ).flatMap((file) => readStatements(schema, file));

      yield* Effect.logInfo({
        msg: `Started migrating '${schema}' schema`,
        statement_count: statements.length,
      });

      const isMigrated = yield* db
        .run(
          [
            rawSql("SET LOCAL statement_timeout = 3600000"),
            ...statements.map(rawSql),
          ],
          { label: "migrate_sync", ...context },
        )
        .pipe(
          Effect.as(true),
          // Note: Concurrent startups wait on `CREATE SCHEMA` until the first one
          // commits, then fail with a unique violation. The first startup migrated
          // the schema.
          Effect.catchIf(
            (error) =>
              error instanceof UniqueConstraintError &&
              error.message.includes("pg_namespace_nspname_index"),
            () => Effect.succeed(false),
          ),
        );

      if (isMigrated) {
        yield* Effect.logInfo({
          msg: `Migrated '${schema}' schema`,
          duration: yield* endClock,
        });
      }
    }
  });

/** Fail with a `MigrationError` instead of an error that `name` already exists. */
const alreadyExists =
  (message: string) =>
  <A, R>(effect: Effect.Effect<A, Error, R>) =>
    Effect.mapError(effect, (error) => {
      if (!error.message.includes("already exists")) return error;
      const e = new MigrationError(message);
      e.stack = undefined;
      return e;
    });

type MigrateParams = {
  namespace: NamespaceBuild;
  preBuild: Pick<PreBuild, "ordering">;
  schemaBuild: Omit<SchemaBuild, "graphqlSchema">;
} & Pick<IndexingBuild, "buildId" | "chains" | "rpcs" | "finalizedBlocks">;

/**
 * Create the tables of the user schema, or check and crash recover the tables
 * of the previous app, and lock the schema for this app.
 *
 * Waits until the finalized block of each chain is at or after the finalized
 * checkpoint of the previous app, and updates `finalizedBlocks` in place.
 * Waits for the lock of a different app to expire.
 *
 * @returns The crash recovery checkpoint for each chain if there is a cache hit, else undefined.
 */
export const migrateApp = (
  db: DbClient,
  {
    namespace,
    preBuild,
    schemaBuild,
    buildId,
    chains,
    rpcs,
    finalizedBlocks,
  }: MigrateParams,
): Effect.Effect<CrashRecoveryCheckpoint, Error, Options> =>
  Effect.gen(function* () {
    const options = yield* Options;

    const PONDER_META = getPonderMetaTable(namespace.schema);
    const PONDER_CHECKPOINT = getPonderCheckpointTable(namespace.schema);
    const tables = Object.values(schemaBuild.schema).filter(isTable);
    const views = Object.values(schemaBuild.schema).filter(isView);
    const { statements } = schemaBuild;

    const context = { logAnnotations: { action: "migrate" } };
    const schema = `"${namespace.schema}"`;

    const createTables = (tx: DbTransaction) =>
      Effect.gen(function* () {
        for (let i = 0; i < statements.tables.sql.length; i++) {
          const { schema: schemaName, tableName } = statements.tables.json[i]!;
          const createTable = statements.tables.sql[i]!;
          const tableStatements =
            preBuild.ordering === "experimental_isolated" &&
            tableName.startsWith("_reorg__") === false
              ? [
                  rawSql(
                    `${createTable.slice(0, createTable.length - 2)} PARTITION BY LIST (chain_id);`,
                  ),
                  ...chains.map((chain) =>
                    rawSql(
                      `CREATE TABLE "${schemaName}"."${getPartitionName(tableName, chain.id)}" PARTITION OF "${schemaName}"."${tableName}" FOR VALUES IN (${chain.id});`,
                    ),
                  ),
                ]
              : [rawSql(createTable)];

          yield* tx
            .run(tableStatements, context)
            .pipe(
              alreadyExists(
                `Unable to create table '${namespace.schema}'.'${tableName}' because a table with that name already exists.`,
              ),
            );
        }

        yield* tx.run(
          tables.map((table) =>
            rawSql(
              `CREATE INDEX IF NOT EXISTS "${getTableName(table)}_checkpoint_index" ON ${schema}."${getReorgTableName(table)}" ("checkpoint")`,
            ),
          ),
          context,
        );
      });

    const createViewsAndEnums = (tx: DbTransaction, kind: "views" | "enums") =>
      Effect.gen(function* () {
        for (let i = 0; i < statements[kind].sql.length; i++) {
          yield* tx
            .run(rawSql(statements[kind].sql[i]!), context)
            .pipe(
              alreadyExists(
                kind === "views"
                  ? `Unable to create view "${namespace.schema}"."${statements.views.json[i]!.name}" because a view with that name already exists.`
                  : `Unable to create enum "${namespace.schema}"."${statements.enums.json[i]!.name}" because an enum with that name already exists.`,
              ),
            );
        }
      });

    const createSchemaObjects = (tx: DbTransaction) =>
      Effect.gen(function* () {
        const endClock = yield* startClockEffect;
        yield* createViewsAndEnums(tx, "enums");
        yield* createTables(tx);
        yield* createViewsAndEnums(tx, "views");

        yield* Effect.logInfo({
          msg: "Created database tables",
          count: tables.length,
          tables: JSON.stringify(tables.map(getTableName)),
          duration: yield* endClock,
        });
        if (views.length > 0) {
          yield* Effect.logInfo({
            msg: "Created database views",
            count: views.length,
            views: JSON.stringify(views.map(getViewName)),
            duration: yield* endClock,
          });
        }
      });

    const adminObjects: Statement[] = [
      rawSql(`
CREATE TABLE IF NOT EXISTS ${schema}."${PONDER_META_TABLE_NAME}" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL
)`),
      rawSql(`
CREATE TABLE IF NOT EXISTS ${schema}."${PONDER_CHECKPOINT_TABLE_NAME}" (
  "chain_name" TEXT PRIMARY KEY,
  "chain_id" BIGINT NOT NULL,
  "safe_checkpoint" VARCHAR(75) NOT NULL,
  "latest_checkpoint" VARCHAR(75) NOT NULL,
  "finalized_checkpoint" VARCHAR(75) NOT NULL
)`),
      rawSql(
        `CREATE SEQUENCE IF NOT EXISTS ${schema}."${getReorgSequenceName()}" AS integer INCREMENT BY 1`,
      ),
    ];

    const migrateInTransaction = (tx: DbTransaction) =>
      Effect.gen(function* () {
        let endClock = yield* startClockEffect;

        yield* tx.run(
          [
            rawSql(`CREATE SCHEMA IF NOT EXISTS ${schema}`),
            ...(tx.dialect === "pglite"
              ? [rawSql(`SET search_path TO ${schema}`)]
              : []),
            ...adminObjects,
          ],
          { label: "migrate", ...context },
        );

        // Note: All ponder versions are compatible with this query (every
        // version of the "_ponder_meta" table have the same columns).
        const [previous] = yield* tx.run(
          builder
            .select({ value: PONDER_META.value })
            .from(PONDER_META)
            .where(eq(PONDER_META.key, "app")),
          context,
        );
        const previousApp = previous?.value;

        yield* Effect.logDebug({
          msg: "Created internal database objects",
          schema: namespace.schema,
          table_count: 2,
          trigger_count: 2,
          duration: yield* endClock,
        });

        const metadata = {
          version: VERSION,
          build_id: buildId,
          table_names: tables.map(getTableName),
          view_names: views.map(getViewName),
          is_dev: options.command === "dev" ? 1 : 0,
          is_locked: 1,
          is_ready: 0,
          heartbeat_at: yield* Clock.currentTimeMillis,
        } satisfies PonderApp6;

        if (previousApp === undefined) {
          yield* createSchemaObjects(tx);
          yield* tx.run(
            [
              ...createLiveQueryProcedures({ namespaceBuild: namespace }),
              builder
                .insert(PONDER_META)
                .values({ key: "app", value: metadata }),
            ],
            context,
          );
          return {
            status: "success",
            crashRecoveryCheckpoint: undefined,
          } as const;
        }

        if (previousApp.is_dev === 1) {
          endClock = yield* startClockEffect;

          yield* tx.run(
            [
              ...(previousApp.table_names ?? []).flatMap((table) => [
                rawSql(`DROP TABLE IF EXISTS ${schema}."${table}" CASCADE`),
                rawSql(
                  `DROP TABLE IF EXISTS ${schema}."${getReorgTableName(table)}" CASCADE`,
                ),
              ]),
              ...(previousApp.view_names ?? []).map((view) =>
                rawSql(`DROP VIEW IF EXISTS ${schema}."${view}" CASCADE`),
              ),
              ...statements.enums.json.map((enumName) =>
                rawSql(`DROP TYPE IF EXISTS ${schema}."${enumName.name}"`),
              ),
            ],
            context,
          );

          yield* Effect.logWarning({
            msg: "Dropped existing database tables",
            count: previousApp.table_names?.length,
            tables: JSON.stringify(previousApp.table_names),
            duration: yield* endClock,
          });
          if (previousApp.view_names?.length > 0) {
            yield* Effect.logWarning({
              msg: "Dropped existing database views",
              count: previousApp.view_names?.length,
              views: JSON.stringify(previousApp.view_names),
            });
          }

          yield* createSchemaObjects(tx);

          endClock = yield* startClockEffect;
          yield* tx.run(
            [
              rawSql(
                `DROP TABLE IF EXISTS ${schema}."${PONDER_CHECKPOINT_TABLE_NAME}" CASCADE`,
              ),
              rawSql(
                `DROP TABLE IF EXISTS ${schema}."${PONDER_META_TABLE_NAME}" CASCADE`,
              ),
              rawSql(
                `DROP FUNCTION IF EXISTS ${schema}.${getLiveQueryProcedureName()}`,
              ),
              rawSql(
                `DROP FUNCTION IF EXISTS ${schema}.${getLiveQueryNotifyProcedureName()}`,
              ),
              ...adminObjects,
              ...createLiveQueryProcedures({ namespaceBuild: namespace }),
              builder
                .insert(PONDER_META)
                .values({ key: "app", value: metadata }),
            ],
            context,
          );

          yield* Effect.logDebug({
            msg: "Reset internal database objects",
            schema: namespace.schema,
            duration: yield* endClock,
          });
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
          return yield* Effect.fail(error);
        }

        if (
          process.env.PONDER_EXPERIMENTAL_DB !== "platform" &&
          (options.command === "dev" || previousApp.build_id !== buildId)
        ) {
          const error = new MigrationError(
            `Schema "${namespace.schema}" was previously used by a different Ponder app. Drop the schema first, or use a different schema. Read more: https://ponder.sh/docs/database#database-schema`,
          );
          error.stack = undefined;
          return yield* Effect.fail(error);
        }

        const expiry =
          previousApp.heartbeat_at + options.databaseHeartbeatTimeout;

        const isAppUnlocked =
          previousApp.is_locked === 0 ||
          expiry <= (yield* Clock.currentTimeMillis);

        if (isAppUnlocked === false) {
          return { status: "locked", expiry } as const;
        }

        yield* Effect.logInfo({
          msg: "Detected crash recovery",
          build_id: buildId,
          last_active: formatEta(
            (yield* Clock.currentTimeMillis) - previousApp.heartbeat_at,
          ),
          schema: namespace.schema,
        });

        const checkpoints = yield* tx.run(
          builder.select().from(PONDER_CHECKPOINT),
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
          const chainIndex = chains.findIndex((c) => c.id === chainId);
          if (
            hexToBigInt(finalizedBlocks[chainIndex]!.timestamp) <
            decodeCheckpoint(finalizedCheckpoint).blockTimestamp
          ) {
            return { status: "behind", chainIndex } as const;
          }
        }

        const crashRecoveryCheckpoint = checkpoints.map((c) => ({
          chainId: c.chainId,
          checkpoint: c.safeCheckpoint,
        }));

        // Note: The statements below will not affect chains that are not "live".
        // `_ponder_checkpoint` is updated by the runtime, not here.

        const removeTriggers =
          preBuild.ordering === "experimental_isolated"
            ? checkpoints.flatMap(({ chainId }) => [
                ...dropTriggers({ tables, chainId }),
                ...dropLiveQueryTriggers({
                  namespaceBuild: namespace,
                  tables,
                  chainId,
                }),
              ])
            : [
                ...dropTriggers({ tables }),
                ...dropLiveQueryTriggers({ namespaceBuild: namespace, tables }),
              ];

        yield* tx.run(
          [
            ...removeTriggers,
            ...statements.indexes.json.map((index) =>
              rawSql(`DROP INDEX IF EXISTS ${schema}."${index.data.name}"`),
            ),
            ...tables.map((table) => crashRecovery({ table })),
            builder.update(PONDER_META).set({ value: metadata }),
          ],
          context,
        );
        return { status: "success", crashRecoveryCheckpoint } as const;
      });

    const tryMigrate = Effect.scoped(
      Effect.gen(function* () {
        const tx = yield* db.begin;
        const result = yield* migrateInTransaction(tx);
        yield* tx.commit;
        return result;
      }),
    );

    // Note: The finalized block can be behind the finalized checkpoint of the
    // previous app when the RPC lags behind the RPC of the previous app.
    const waitAndMigrate = Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      let warnedAt: number | undefined;
      let result = yield* tryMigrate;
      while (result.status === "behind") {
        const chain = chains[result.chainIndex]!;
        const rpc = rpcs[result.chainIndex]!;
        const now = yield* Clock.currentTimeMillis;
        // Note: Warn at most every 30 seconds.
        if (warnedAt === undefined || now - warnedAt >= 30_000) {
          warnedAt = now;
          yield* Effect.logWarning({
            msg: "Finalized block is behind the previous app",
            chain: chain.name,
            chain_id: chain.id,
            finalized_block: hexToNumber(
              finalizedBlocks[result.chainIndex]!.number,
            ),
            duration: warnedAt - startedAt,
          });
        }

        yield* Effect.sleep(chain.pollingInterval);

        const latestBlock = yield* eth_getBlockByNumber(
          rpc,
          ["latest", false],
          { ...context, retryNullBlockRequest: true },
        );
        finalizedBlocks[result.chainIndex] = yield* getFinalizedBlock({
          chain,
          rpc,
          latestBlock,
        });

        result = yield* tryMigrate;
      }
      return result;
    });

    let result = yield* waitAndMigrate;
    if (result.status === "locked") {
      const duration = result.expiry - (yield* Clock.currentTimeMillis);
      yield* Effect.logWarning({
        msg: "Schema is locked by a different Ponder app",
        schema: namespace.schema,
        retry_delay: duration,
      });

      yield* Effect.sleep(duration);

      result = yield* waitAndMigrate;
      if (result.status === "locked") {
        const error = new MigrationError(
          `Failed to acquire lock on schema "${namespace.schema}". A different Ponder app is actively using this schema.`,
        );
        error.stack = undefined;
        return yield* Effect.fail(error);
      }
    }

    return result.crashRecoveryCheckpoint;
  });

/**
 * Keep the lock that {@link migrateApp} took on the user schema with a
 * heartbeat, until the scope closes and unlocks it.
 *
 * @dev Only the lock of this build is unlocked, so a failed startup doesn't
 * unlock a schema that another app holds.
 */
export const lockApp = (
  db: DbClient,
  { namespace, buildId }: { namespace: NamespaceBuild; buildId: string },
): Effect.Effect<void, never, Options | Scope.Scope> =>
  Effect.gen(function* () {
    const options = yield* Options;
    const PONDER_META = getPonderMetaTable(namespace.schema);

    // Note: Finalizers run in reverse order, so the heartbeat stops first.
    yield* Effect.addFinalizer(() =>
      ["start", "dev"].includes(options.command)
        ? db
            .run(
              builder
                .update(PONDER_META)
                .set({
                  value: sql`jsonb_set(value, '{is_locked}', to_jsonb(0))`,
                })
                .where(sql`${PONDER_META.value} ->> 'build_id' = ${buildId}`),
              { label: "unlock" },
            )
            .pipe(Effect.ignore)
        : Effect.void,
    );

    const updateHeartbeat = Effect.gen(function* () {
      const heartbeat = yield* Clock.currentTimeMillis;
      const endClock = yield* startClockEffect;

      yield* db.run(
        builder.update(PONDER_META).set({
          value: sql`jsonb_set(value, '{heartbeat_at}', to_jsonb(${heartbeat}::bigint))`,
        }),
        { label: "update_heartbeat" },
      );

      yield* Effect.logTrace({
        msg: "Updated heartbeat timestamp",
        heartbeat,
        build_id: buildId,
        schema: namespace.schema,
        duration: yield* endClock,
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.logError({
          msg: "Failed to update heartbeat timestamp",
          retry_delay: options.databaseHeartbeatInterval,
          error,
        }),
      ),
    );

    yield* updateHeartbeat.pipe(
      Effect.delay(options.databaseHeartbeatInterval),
      Effect.forever,
      Effect.forkScoped,
    );
  });
