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
} from "@/drizzle/onchain.js";
import { MigrationError, UniqueConstraintError } from "@/internal/errors.js";
import { makeLogUnsafe } from "@/internal/logger.js";
import { Options } from "@/internal/options.js";
import type {
  CrashRecoveryCheckpoint,
  IndexingBuild,
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
} from "@/internal/types.js";
import { eth_getBlockByNumber } from "@/rpc/actions.js";
import * as PONDER_SYNC from "@/sync-store/schema.js";
import { decodeCheckpoint } from "@/utils/checkpoint.js";
import { getFinalizedBlock } from "@/utils/finality.js";
import { formatEta } from "@/utils/format.js";
import { startClock, startClockEffect } from "@/utils/timer.js";
import {
  crashRecovery,
  createLiveQueryProcedures,
  dropLiveQueryTriggers,
  dropTriggers,
} from "./actions.js";
import { Db, type DbClient } from "./db.js";
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

/**
 * Migrate the `ponder_sync` schema.
 */
export const migrateSync: Effect.Effect<void, Error, Db> = Effect.gen(
  function* () {
    const db = yield* Db;
    const logUnsafe = yield* makeLogUnsafe;

    const migratedSchemas = yield* db.admin
      .query(
        (db) =>
          db.transaction(
            async (tx) => {
              await tx.execute(sql`SET LOCAL statement_timeout = 3600000`);

              const dbSchemas = await tx
                .select()
                .from(SCHEMATA)
                .where(
                  inArray(SCHEMATA.schemaName, [
                    ...PONDER_SYNC.PONDER_SYNC_SCHEMAS,
                  ]),
                )
                .then((result) => result.map((r) => r.schemaName));

              if (dbSchemas.includes("ponder_sync")) {
                const migrations = await tx.select().from(LEGACY_MIGRATIONS);

                if (
                  migrations.some(
                    (migration) =>
                      migration.name === "2025_02_26_1_rpc_request_results",
                  ) === false
                ) {
                  throw new MigrationError(
                    '"ponder_sync" migration failed. Please first update to v0.10 or "DROP SCHEMA ponder_sync CASCADE".',
                  );
                }
              }

              const migratedSchemas: {
                schema: string;
                duration: number;
              }[] = [];
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
                const endSchemaClock = startClock();

                const files = isNewDatabase
                  ? ["create.sql"]
                  : ["create.sql", "copy.sql"];
                const statements = files.flatMap((file) =>
                  fs
                    .readFileSync(
                      new URL(
                        `../sync-store/sql/${schema}/${file}`,
                        import.meta.url,
                      ),
                      "utf-8",
                    )
                    .split("--> statement-breakpoint")
                    .map((statement) => statement.trim())
                    .filter((statement) => statement.length > 0),
                );

                logUnsafe(
                  Effect.logInfo({
                    msg: `Started migrating '${schema}' schema`,
                    statement_count: statements.length,
                  }),
                );

                for (let i = 0; i < statements.length; i++) {
                  const statement = statements[i]!;
                  // Log only the first non-comment line; CREATE TABLE statements span many lines.
                  const summary = (
                    statement
                      .split("\n")
                      .find((line) => line.startsWith("--") === false) ?? ""
                  ).slice(0, 120);

                  logUnsafe(
                    Effect.logDebug({
                      msg: "Started migration statement",
                      schema,
                      statement_index: i,
                      statement: summary,
                    }),
                  );

                  const endClock = startClock();
                  await tx.execute(sql.raw(statement));

                  logUnsafe(
                    Effect.logDebug({
                      msg: "Completed migration statement",
                      schema,
                      statement_index: i,
                      statement: summary,
                      duration: endClock(),
                    }),
                  );
                }
                migratedSchemas.push({
                  schema,
                  duration: endSchemaClock(),
                });
              }
              return migratedSchemas;
            },
            { isolationLevel: "repeatable read" },
          ),
        { label: "migrate_sync" },
      )
      .pipe(
        // Note: Concurrent startups wait on `CREATE SCHEMA` until the first one
        // commits, then fail with a unique violation. The first startup migrated
        // the schemas.
        Effect.catchIf(
          (error) =>
            error instanceof UniqueConstraintError &&
            error.message.includes("pg_namespace_nspname_index"),
          () => Effect.succeed([]),
        ),
      );

    for (const { schema, duration } of migratedSchemas) {
      yield* Effect.logInfo({
        msg: `Migrated '${schema}' schema`,
        duration,
      });
    }
  },
);

/**
 * Migrate the user schema, and hold the lock on it with a heartbeat until the
 * scope closes.
 *
 * Waits until the finalized block of each chain is at or after the finalized
 * checkpoint of the previous app, and updates `finalizedBlocks` in place.
 *
 * @returns The crash recovery checkpoint for each chain if there is a cache hit, else undefined.
 */
export const migrate = ({
  namespace,
  preBuild,
  schemaBuild,
  buildId,
  chains,
  rpcs,
  finalizedBlocks,
}: {
  namespace: NamespaceBuild;
  preBuild: Pick<PreBuild, "ordering">;
  schemaBuild: Omit<SchemaBuild, "graphqlSchema">;
} & Pick<
  IndexingBuild,
  "buildId" | "chains" | "rpcs" | "finalizedBlocks"
>): Effect.Effect<CrashRecoveryCheckpoint, Error, Db | Options | Scope.Scope> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const options = yield* Options;

    const PONDER_META = getPonderMetaTable(namespace.schema);
    const PONDER_CHECKPOINT = getPonderCheckpointTable(namespace.schema);
    const tables = Object.values(schemaBuild.schema).filter(isTable);
    const views = Object.values(schemaBuild.schema).filter(isView);

    const context = {
      logAnnotations: { action: "migrate" },
    };

    const createTables = (tx: DbClient) =>
      Effect.gen(function* () {
        for (let i = 0; i < schemaBuild.statements.tables.sql.length; i++) {
          yield* Effect.gen(function* () {
            const schemaName = schemaBuild.statements.tables.json[i]!.schema;
            const tableName = schemaBuild.statements.tables.json[i]!.tableName;
            if (
              preBuild.ordering === "experimental_isolated" &&
              tableName.startsWith("_reorg__") === false
            ) {
              const sql = schemaBuild.statements.tables.sql[i]!;
              yield* tx.query((tx) =>
                tx.execute(
                  `${sql.slice(0, sql.length - 2)} PARTITION BY LIST (chain_id);`,
                ),
              );

              for (const chain of chains) {
                yield* tx.query((tx) =>
                  tx.execute(
                    `CREATE TABLE "${schemaName}"."${getPartitionName(tableName, chain.id)}" PARTITION OF "${schemaName}"."${tableName}" FOR VALUES IN (${chain.id});`,
                  ),
                );
              }
            } else {
              yield* tx.query(
                (tx) => tx.execute(schemaBuild.statements.tables.sql[i]!),
                context,
              );
            }
          }).pipe(
            Effect.mapError((error) => {
              if (!error.message.includes("already exists")) return error;
              const e = new MigrationError(
                `Unable to create table '${namespace.schema}'.'${schemaBuild.statements.tables.json[i]!.tableName}' because a table with that name already exists.`,
              );
              e.stack = undefined;
              return e;
            }),
          );
        }

        for (const table of tables) {
          yield* tx.query(
            (tx) =>
              tx.execute(
                `CREATE INDEX IF NOT EXISTS "${getTableName(table)}_checkpoint_index" ON "${namespace.schema}"."${getReorgTableName(table)}" ("checkpoint")`,
              ),
            context,
          );
        }
      });

    const createViews = (tx: DbClient) =>
      Effect.gen(function* () {
        for (let i = 0; i < schemaBuild.statements.views.sql.length; i++) {
          yield* tx
            .query(
              (tx) => tx.execute(schemaBuild.statements.views.sql[i]!),
              context,
            )
            .pipe(
              Effect.mapError((error) => {
                if (!error.message.includes("already exists")) return error;
                const e = new MigrationError(
                  `Unable to create view "${namespace.schema}"."${schemaBuild.statements.views.json[i]!.name}" because a view with that name already exists.`,
                );
                e.stack = undefined;
                return e;
              }),
            );
        }
      });

    const createEnums = (tx: DbClient) =>
      Effect.gen(function* () {
        for (let i = 0; i < schemaBuild.statements.enums.sql.length; i++) {
          yield* tx
            .query(
              (tx) => tx.execute(schemaBuild.statements.enums.sql[i]!),
              context,
            )
            .pipe(
              Effect.mapError((error) => {
                if (!error.message.includes("already exists")) return error;
                const e = new MigrationError(
                  `Unable to create enum "${namespace.schema}"."${schemaBuild.statements.enums.json[i]!.name}" because an enum with that name already exists.`,
                );
                e.stack = undefined;
                return e;
              }),
            );
        }
      });

    const createAdminObjects = (tx: DbClient) =>
      Effect.gen(function* () {
        yield* tx.query(
          (tx) =>
            tx.execute(
              `
CREATE TABLE IF NOT EXISTS "${namespace.schema}"."${PONDER_META_TABLE_NAME}" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL
)`,
            ),
          context,
        );

        yield* tx.query(
          (tx) =>
            tx.execute(
              `
CREATE TABLE IF NOT EXISTS "${namespace.schema}"."${PONDER_CHECKPOINT_TABLE_NAME}" (
  "chain_name" TEXT PRIMARY KEY,
  "chain_id" BIGINT NOT NULL,
  "safe_checkpoint" VARCHAR(75) NOT NULL,
  "latest_checkpoint" VARCHAR(75) NOT NULL,
  "finalized_checkpoint" VARCHAR(75) NOT NULL
)`,
            ),
          context,
        );

        yield* tx.query(
          (tx) =>
            tx.execute(
              `CREATE SEQUENCE IF NOT EXISTS "${namespace.schema}"."${getReorgSequenceName()}" AS integer INCREMENT BY 1`,
            ),
          context,
        );
      });

    const tryAcquireLockAndMigrate = () =>
      db.admin.transaction(
        (tx) =>
          Effect.gen(function* () {
            yield* tx.query(
              (tx) =>
                tx.execute(`CREATE SCHEMA IF NOT EXISTS "${namespace.schema}"`),
              context,
            );

            if (db.dialect === "pglite") {
              yield* tx.query(
                (tx) => tx.execute(`SET search_path TO "${namespace.schema}"`),
                context,
              );
            }

            yield* createAdminObjects(tx);

            let endClock = yield* startClockEffect;

            yield* Effect.logDebug({
              msg: "Created internal database objects",
              schema: namespace.schema,
              table_count: 2,
              trigger_count: 2,
              duration: yield* endClock,
            });

            // Note: All ponder versions are compatible with the next query (every version of the "_ponder_meta" table have the same columns)

            const previousApp = yield* tx.query(
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
              is_dev: options.command === "dev" ? 1 : 0,
              is_locked: 1,
              is_ready: 0,
              heartbeat_at: yield* Clock.currentTimeMillis,
            } satisfies PonderApp6;

            if (previousApp === undefined) {
              endClock = yield* startClockEffect;
              yield* createEnums(tx);
              yield* createTables(tx);
              yield* createViews(tx);
              yield* createLiveQueryProcedures(
                tx,
                { namespaceBuild: namespace },
                context,
              );

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

              yield* tx.query(
                (tx) =>
                  tx
                    .insert(PONDER_META)
                    .values({ key: "app", value: metadata }),
                context,
              );
              return {
                status: "success",
                crashRecoveryCheckpoint: undefined,
              } as const;
            }

            if (previousApp.is_dev === 1) {
              endClock = yield* startClockEffect;

              for (const table of previousApp.table_names ?? []) {
                yield* tx.query(
                  (tx) =>
                    tx.execute(
                      `DROP TABLE IF EXISTS "${namespace.schema}"."${table}" CASCADE`,
                    ),
                  context,
                );
                yield* tx.query(
                  (tx) =>
                    tx.execute(
                      `DROP TABLE IF EXISTS "${namespace.schema}"."${getReorgTableName(table)}" CASCADE`,
                    ),
                  context,
                );
              }
              for (const view of previousApp.view_names ?? []) {
                yield* tx.query(
                  (tx) =>
                    tx.execute(
                      `DROP VIEW IF EXISTS "${namespace.schema}"."${view}" CASCADE`,
                    ),
                  context,
                );
              }
              for (const enumName of schemaBuild.statements.enums.json) {
                yield* tx.query(
                  (tx) =>
                    tx.execute(
                      `DROP TYPE IF EXISTS "${namespace.schema}"."${enumName.name}"`,
                    ),
                  context,
                );
              }

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

              endClock = yield* startClockEffect;

              yield* createEnums(tx);
              yield* createTables(tx);
              yield* createViews(tx);

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

              endClock = yield* startClockEffect;

              yield* tx.query(
                (tx) =>
                  tx.execute(
                    `DROP TABLE IF EXISTS "${namespace.schema}"."${PONDER_CHECKPOINT_TABLE_NAME}" CASCADE`,
                  ),
                context,
              );

              yield* tx.query(
                (tx) =>
                  tx.execute(
                    `DROP TABLE IF EXISTS "${namespace.schema}"."${PONDER_META_TABLE_NAME}" CASCADE`,
                  ),
                context,
              );

              yield* tx.query((tx) =>
                tx.execute(
                  `DROP FUNCTION IF EXISTS "${namespace.schema}".${getLiveQueryProcedureName()}`,
                ),
              );

              yield* tx.query((tx) =>
                tx.execute(
                  `DROP FUNCTION IF EXISTS "${namespace.schema}".${getLiveQueryNotifyProcedureName()}`,
                ),
              );

              yield* createAdminObjects(tx);
              yield* createLiveQueryProcedures(
                tx,
                { namespaceBuild: namespace },
                context,
              );

              yield* Effect.logDebug({
                msg: "Reset internal database objects",
                schema: namespace.schema,
                duration: yield* endClock,
              });

              yield* tx.query(
                (tx) =>
                  tx
                    .insert(PONDER_META)
                    .values({ key: "app", value: metadata }),
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

            const checkpoints = yield* tx.query(
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

            // Remove triggers

            if (preBuild.ordering === "experimental_isolated") {
              for (const { chainId } of checkpoints) {
                yield* dropTriggers(tx, { tables, chainId });
                yield* dropLiveQueryTriggers(
                  tx,
                  { namespaceBuild: namespace, tables, chainId },
                  context,
                );
              }
            } else {
              yield* dropTriggers(tx, { tables });
              yield* dropLiveQueryTriggers(
                tx,
                { namespaceBuild: namespace, tables },
                context,
              );
            }

            // Remove indexes

            for (const indexStatement of schemaBuild.statements.indexes.json) {
              yield* tx.query(
                (tx) =>
                  tx.execute(
                    `DROP INDEX IF EXISTS "${namespace.schema}"."${indexStatement.data.name}"`,
                  ),
                context,
              );
            }

            for (const table of tables) {
              yield* crashRecovery(tx, { table });
            }

            // Note: We don't update the `_ponder_checkpoint` table here, instead we wait for it to be updated
            // in the runtime script.

            yield* tx.query(
              (tx) => tx.update(PONDER_META).set({ value: metadata }),
              context,
            );
            return { status: "success", crashRecoveryCheckpoint } as const;
          }),
        { label: "migrate" },
      );

    // Note: The finalized block can be behind the finalized checkpoint of the
    // previous app when the RPC lags behind the RPC of the previous app.
    const waitAndMigrate = Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      let warnedAt: number | undefined;
      let result = yield* tryAcquireLockAndMigrate();
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

        result = yield* tryAcquireLockAndMigrate();
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

    // Note: Unlock only after acquiring the lock, and only the lock of this
    // build, so a failed startup doesn't unlock a schema that another app holds.
    // Finalizers run in reverse order, so the heartbeat stops first.
    yield* Effect.addFinalizer(() =>
      ["start", "dev"].includes(options.command)
        ? db.admin
            .query(
              (db) =>
                db
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

      yield* db.admin.query(
        (db) =>
          db.update(PONDER_META).set({
            value: sql`jsonb_set(value, '{heartbeat_at}', ${heartbeat})`,
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

    return result.crashRecoveryCheckpoint;
  });
