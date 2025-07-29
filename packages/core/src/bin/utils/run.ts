import { runCodegen } from "@/bin/utils/codegen.js";
import {
  commitBlock,
  createIndexes,
  createTriggers,
  dropTriggers,
  finalize,
  revert,
} from "@/database/actions.js";
import {
  type Database,
  getPonderCheckpointTable,
  getPonderMetaTable,
} from "@/database/index.js";
import { createIndexingCache } from "@/indexing-store/cache.js";
import { createHistoricalIndexingStore } from "@/indexing-store/historical.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import { createCachedViemClient } from "@/indexing/client.js";
import { createIndexing } from "@/indexing/index.js";
import type { Common } from "@/internal/common.js";
import { RetryableError } from "@/internal/errors.js";
import { getAppProgress } from "@/internal/metrics.js";
import type {
  CrashRecoveryCheckpoint,
  IndexingBuild,
  IndexingErrorHandler,
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
} from "@/internal/types.js";
import { createSyncStore } from "@/sync-store/index.js";
import { createSync, splitEvents } from "@/sync/index.js";
import { decodeCheckpoint } from "@/utils/checkpoint.js";
import { chunk } from "@/utils/chunk.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import { recordAsyncGenerator } from "@/utils/generators.js";
import { never } from "@/utils/never.js";
import { startClock } from "@/utils/timer.js";
import { eq, getTableName, isTable, sql } from "drizzle-orm";

/** Starts the sync and indexing services for the specified build. */
export async function run({
  common,
  preBuild,
  namespaceBuild,
  schemaBuild,
  indexingBuild,
  crashRecoveryCheckpoint,
  database,
}: {
  common: Common;
  preBuild: PreBuild;
  namespaceBuild: NamespaceBuild;
  schemaBuild: SchemaBuild;
  indexingBuild: IndexingBuild;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  database: Database;
}) {
  await database.migrateSync();

  runCodegen({ common });

  const syncStore = createSyncStore({ common, database });

  const PONDER_CHECKPOINT = getPonderCheckpointTable(namespaceBuild.schema);
  const PONDER_META = getPonderMetaTable(namespaceBuild.schema);

  const sync = await createSync({
    common,
    indexingBuild,
    syncStore,
    crashRecoveryCheckpoint,
    ordering: preBuild.ordering,
  });

  const eventCount: { [eventName: string]: number } = {};
  for (const eventName of Object.keys(indexingBuild.indexingFunctions)) {
    eventCount[eventName] = 0;
  }

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild,
    syncStore,
    eventCount,
  });

  const indexingErrorHandler: IndexingErrorHandler = {
    getRetryableError: () => {
      return indexingErrorHandler.error;
    },
    setRetryableError: (error: RetryableError) => {
      indexingErrorHandler.error = error;
    },
    clearRetryableError: () => {
      indexingErrorHandler.error = undefined;
    },
    error: undefined as RetryableError | undefined,
  };

  const indexing = createIndexing({
    common,
    indexingBuild,
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
  });

  const indexingCache = createIndexingCache({
    common,
    schemaBuild,
    crashRecoveryCheckpoint,
    eventCount,
  });

  const historicalIndexingStore = createHistoricalIndexingStore({
    common,
    schemaBuild,
    indexingCache,
    indexingErrorHandler,
  });

  for (const chain of indexingBuild.chains) {
    const label = { chain: chain.name };
    common.metrics.ponder_historical_total_indexing_seconds.set(
      label,
      Math.max(
        sync.seconds[chain.name]!.end - sync.seconds[chain.name]!.start,
        0,
      ),
    );
    common.metrics.ponder_historical_cached_indexing_seconds.set(
      label,
      Math.max(
        sync.seconds[chain.name]!.cached - sync.seconds[chain.name]!.start,
        0,
      ),
    );
    common.metrics.ponder_historical_completed_indexing_seconds.set(label, 0);
    common.metrics.ponder_indexing_timestamp.set(
      label,
      Math.max(
        sync.seconds[chain.name]!.cached,
        sync.seconds[chain.name]!.start,
      ),
    );
  }

  const startTimestamp = Math.round(Date.now() / 1000);
  common.metrics.ponder_historical_start_timestamp_seconds.set(startTimestamp);

  // Reset the start timestamp so the eta estimate doesn't include
  // the startup time.
  common.metrics.start_timestamp = Date.now();

  // If the initial checkpoint is zero, we need to run setup events.
  if (crashRecoveryCheckpoint === undefined) {
    await database.userQB.transaction(async (tx) => {
      historicalIndexingStore.qb = tx;
      indexingCache.qb = tx;

      const result = await indexing.processSetupEvents({
        db: historicalIndexingStore,
      });

      if (result.status === "error") {
        throw result.error;
      }

      await indexingCache.flush();

      await tx.wrap({ label: "update_checkpoints" }, (tx) =>
        tx
          .insert(PONDER_CHECKPOINT)
          .values(
            indexingBuild.chains.map((chain) => ({
              chainName: chain.name,
              chainId: chain.id,
              latestCheckpoint: sync.getStartCheckpoint(chain),
              safeCheckpoint: sync.getStartCheckpoint(chain),
            })),
          )
          .onConflictDoUpdate({
            target: PONDER_CHECKPOINT.chainName,
            set: {
              safeCheckpoint: sql`excluded.safe_checkpoint`,
              latestCheckpoint: sql`excluded.latest_checkpoint`,
            },
          }),
      );
    });
  }

  // Run historical indexing until complete.
  for await (const events of recordAsyncGenerator(
    sync.getHistoricalEvents(),
    (params) => {
      common.metrics.ponder_historical_concurrency_group_duration.inc(
        { group: "extract" },
        params.await,
      );
      common.metrics.ponder_historical_concurrency_group_duration.inc(
        { group: "transform" },
        params.yield,
      );
    },
  )) {
    let endClock = startClock();

    indexingCache.qb = database.userQB;
    await Promise.all([
      indexingCache.prefetch({ events: events.events }),
      cachedViemClient.prefetch({ events: events.events }),
    ]);
    common.metrics.ponder_historical_transform_duration.inc(
      { step: "prefetch" },
      endClock(),
    );
    if (events.events.length > 0) {
      endClock = startClock();
      await database.userQB.transaction(async (tx) => {
        try {
          historicalIndexingStore.qb = tx;
          indexingCache.qb = tx;

          common.metrics.ponder_historical_transform_duration.inc(
            { step: "begin" },
            endClock(),
          );

          endClock = startClock();

          const eventChunks = chunk(events.events, 93);
          for (const eventChunk of eventChunks) {
            const result = await indexing.processEvents({
              events: eventChunk,
              db: historicalIndexingStore,
              cache: indexingCache,
            });

            if (result.status === "error") {
              console.log("hihi");
              throw result.error;
            }

            const checkpoint = decodeCheckpoint(
              eventChunk[eventChunk.length - 1]!.checkpoint,
            );

            if (preBuild.ordering === "multichain") {
              const chain = indexingBuild.chains.find(
                (chain) => chain.id === Number(checkpoint.chainId),
              )!;
              common.metrics.ponder_historical_completed_indexing_seconds.set(
                { chain: chain.name },
                Math.max(
                  Number(checkpoint.blockTimestamp) -
                    Math.max(
                      sync.seconds[chain.name]!.cached,
                      sync.seconds[chain.name]!.start,
                    ),
                  0,
                ),
              );
              common.metrics.ponder_indexing_timestamp.set(
                { chain: chain.name },
                Number(checkpoint.blockTimestamp),
              );
            } else {
              for (const chain of indexingBuild.chains) {
                common.metrics.ponder_historical_completed_indexing_seconds.set(
                  { chain: chain.name },
                  Math.min(
                    Math.max(
                      Number(checkpoint.blockTimestamp) -
                        Math.max(
                          sync.seconds[chain.name]!.cached,
                          sync.seconds[chain.name]!.start,
                        ),
                      0,
                    ),
                    Math.max(
                      sync.seconds[chain.name]!.end -
                        sync.seconds[chain.name]!.start,
                      0,
                    ),
                  ),
                );
                common.metrics.ponder_indexing_timestamp.set(
                  { chain: chain.name },
                  Math.max(
                    Number(checkpoint.blockTimestamp),
                    sync.seconds[chain.name]!.end,
                  ),
                );
              }
            }

            // Note: allows for terminal and logs to be updated
            if (preBuild.databaseConfig.kind === "pglite") {
              await new Promise(setImmediate);
            }
          }
          await new Promise(setImmediate);

          // underlying metrics collection is actually synchronous
          // https://github.com/siimon/prom-client/blob/master/lib/histogram.js#L102-L125
          const { eta, progress } = await getAppProgress(common.metrics);
          if (eta === undefined || progress === undefined) {
            common.logger.info({
              service: "app",
              msg: `Indexed ${events.events.length} events`,
            });
          } else {
            common.logger.info({
              service: "app",
              msg: `Indexed ${events.events.length} events with ${formatPercentage(progress)} complete and ${formatEta(eta * 1_000)} remaining`,
            });
          }

          common.metrics.ponder_historical_transform_duration.inc(
            { step: "index" },
            endClock(),
          );

          endClock = startClock();
          // Note: at this point, the next events can be preloaded, as long as the are not indexed until
          // the "flush" + "finalize" is complete.

          await indexingCache.flush();

          common.metrics.ponder_historical_transform_duration.inc(
            { step: "load" },
            endClock(),
          );
          endClock = startClock();

          if (events.checkpoints.length > 0) {
            await tx.wrap({ label: "update_checkpoints" }, (tx) =>
              tx
                .insert(PONDER_CHECKPOINT)
                .values(
                  events.checkpoints.map(({ chainId, checkpoint }) => ({
                    chainName: indexingBuild.chains.find(
                      (chain) => chain.id === chainId,
                    )!.name,
                    chainId,
                    latestCheckpoint: checkpoint,
                    safeCheckpoint: checkpoint,
                  })),
                )
                .onConflictDoUpdate({
                  target: PONDER_CHECKPOINT.chainName,
                  set: {
                    safeCheckpoint: sql`excluded.safe_checkpoint`,
                    latestCheckpoint: sql`excluded.latest_checkpoint`,
                  },
                }),
            );
          }

          common.metrics.ponder_historical_transform_duration.inc(
            { step: "finalize" },
            endClock(),
          );
          endClock = startClock();
        } catch (error) {
          indexingCache.invalidate();
          indexingCache.clear();

          if (error instanceof RetryableError) {
            common.logger.warn({
              service: "app",
              msg: "Retrying event batch",
            });
          }

          throw error;
        }
      });

      cachedViemClient.clear();
      common.metrics.ponder_historical_transform_duration.inc(
        { step: "commit" },
        endClock(),
      );

      await new Promise(setImmediate);
    }
  }

  indexingCache.clear();

  // Manually update metrics to fix a UI bug that occurs when the end
  // checkpoint is between the last processed event and the finalized
  // checkpoint.

  for (const chain of indexingBuild.chains) {
    const label = { chain: chain.name };
    common.metrics.ponder_historical_completed_indexing_seconds.set(
      label,
      Math.max(
        sync.seconds[chain.name]!.end -
          Math.max(
            sync.seconds[chain.name]!.cached,
            sync.seconds[chain.name]!.start,
          ),
        0,
      ),
    );
    common.metrics.ponder_indexing_timestamp.set(
      { chain: chain.name },
      sync.seconds[chain.name]!.end,
    );
  }

  const endTimestamp = Math.round(Date.now() / 1000);
  common.metrics.ponder_historical_end_timestamp_seconds.set(endTimestamp);

  common.logger.info({
    service: "indexing",
    msg: "Completed historical indexing",
  });

  const tables = Object.values(schemaBuild.schema).filter(isTable);

  await createIndexes(database.adminQB, { statements: schemaBuild.statements });
  await createTriggers(database.adminQB, { tables });

  if (namespaceBuild.viewsSchema) {
    await database.adminQB.transaction(
      { label: "create_views" },
      async (tx) => {
        await tx.wrap((tx) =>
          tx.execute(
            `CREATE SCHEMA IF NOT EXISTS "${namespaceBuild.viewsSchema}"`,
          ),
        );

        for (const table of tables) {
          // Note: drop views before creating new ones to avoid enum errors.
          await tx.wrap((tx) =>
            tx.execute(
              `DROP VIEW IF EXISTS "${namespaceBuild.viewsSchema}"."${getTableName(table)}"`,
            ),
          );

          await tx.wrap((tx) =>
            tx.execute(
              `CREATE VIEW "${namespaceBuild.viewsSchema}"."${getTableName(table)}" AS SELECT * FROM "${namespaceBuild.schema}"."${getTableName(table)}"`,
            ),
          );
        }

        common.logger.info({
          service: "app",
          msg: `Created ${tables.length} views in schema "${namespaceBuild.viewsSchema}"`,
        });

        await tx.wrap((tx) =>
          tx.execute(
            `DROP VIEW IF EXISTS "${namespaceBuild.viewsSchema}"."_ponder_meta"`,
          ),
        );

        await tx.wrap((tx) =>
          tx.execute(
            `DROP VIEW IF EXISTS "${namespaceBuild.viewsSchema}"."_ponder_checkpoint"`,
          ),
        );

        await tx.wrap((tx) =>
          tx.execute(
            `CREATE VIEW "${namespaceBuild.viewsSchema}"."_ponder_meta" AS SELECT * FROM "${namespaceBuild.schema}"."_ponder_meta"`,
          ),
        );

        await tx.wrap((tx) =>
          tx.execute(
            `CREATE VIEW "${namespaceBuild.viewsSchema}"."_ponder_checkpoint" AS SELECT * FROM "${namespaceBuild.schema}"."_ponder_checkpoint"`,
          ),
        );

        const trigger = `status_${namespaceBuild.viewsSchema}_trigger`;
        const notification = "status_notify()";
        const channel = `${namespaceBuild.viewsSchema}_status_channel`;

        await tx.wrap((tx) =>
          tx.execute(`
CREATE OR REPLACE FUNCTION "${namespaceBuild.viewsSchema}".${notification}
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
NOTIFY "${channel}";
RETURN NULL;
END;
$$;`),
        );

        await tx.wrap((tx) =>
          tx.execute(`
CREATE OR REPLACE TRIGGER "${trigger}"
AFTER INSERT OR UPDATE OR DELETE
ON "${namespaceBuild.schema}"._ponder_checkpoint
FOR EACH STATEMENT
EXECUTE PROCEDURE "${namespaceBuild.viewsSchema}".${notification};`),
        );
      },
    );
  }

  await database.adminQB.wrap({ label: "update_ready" }, (db) =>
    db
      .update(PONDER_META)
      .set({ value: sql`jsonb_set(value, '{is_ready}', to_jsonb(1))` }),
  );

  const realtimeIndexingStore = createRealtimeIndexingStore({
    common,
    schemaBuild,
    indexingErrorHandler,
  });

  common.logger.info({
    service: "server",
    msg: "Started returning 200 responses from /ready endpoint",
  });

  for await (const event of sync.getRealtimeEvents()) {
    switch (event.type) {
      case "block": {
        if (event.events.length > 0) {
          // Events must be run block-by-block, so that `database.commitBlock` can accurately
          // update the temporary `checkpoint` value set in the trigger.

          const perBlockEvents = splitEvents(event.events);

          common.logger.debug({
            service: "app",
            msg: `Partitioned events into ${perBlockEvents.length} blocks`,
          });

          for (const { checkpoint, events } of perBlockEvents) {
            await database.userQB.transaction(async (tx) => {
              const chain = indexingBuild.chains.find(
                (chain) =>
                  chain.id === Number(decodeCheckpoint(checkpoint).chainId),
              )!;

              try {
                realtimeIndexingStore.qb = tx;

                const result = await indexing.processEvents({
                  events,
                  db: realtimeIndexingStore,
                });

                common.logger.info({
                  service: "app",
                  msg: `Indexed ${events.length} '${chain.name}' events for block ${Number(decodeCheckpoint(checkpoint).blockNumber)}`,
                });

                if (result.status === "error") {
                  throw result.error;
                }

                await Promise.all(
                  tables.map((table) => commitBlock(tx, { table, checkpoint })),
                );

                if (preBuild.ordering === "multichain") {
                  common.metrics.ponder_indexing_timestamp.set(
                    { chain: chain.name },
                    Number(decodeCheckpoint(checkpoint).blockTimestamp),
                  );
                } else {
                  for (const chain of indexingBuild.chains) {
                    common.metrics.ponder_indexing_timestamp.set(
                      { chain: chain.name },
                      Number(decodeCheckpoint(checkpoint).blockTimestamp),
                    );
                  }
                }
              } catch (error) {
                common.logger.warn({
                  service: "app",
                  msg: `Retrying '${chain.name}' events for block ${Number(decodeCheckpoint(checkpoint).blockNumber)}`,
                });

                throw error;
              }
            });
          }
        }

        await database.userQB.wrap({ label: "update_checkpoints" }, (db) =>
          db
            .update(PONDER_CHECKPOINT)
            .set({ latestCheckpoint: event.checkpoint })
            .where(eq(PONDER_CHECKPOINT.chainName, event.chain.name)),
        );

        event.blockCallback?.(true);

        break;
      }
      case "reorg":
        // Note: `_ponder_checkpoint` is not called here, instead it is called
        // in the `block` case.

        await database.userQB.transaction(async (tx) => {
          await dropTriggers(tx, { tables });

          const counts = await revert(tx, {
            tables,
            checkpoint: event.checkpoint,
            ordering: preBuild.ordering,
          });

          for (const [index, table] of tables.entries()) {
            common.logger.info({
              service: "database",
              msg: `Reverted ${counts[index]} unfinalized operations from '${getTableName(table)}'`,
            });
          }

          await createTriggers(tx, { tables });
        });

        break;
      case "finalize":
        await database.userQB.transaction(async (tx) => {
          await tx.wrap((tx) =>
            tx.update(PONDER_CHECKPOINT).set({
              safeCheckpoint: event.checkpoint,
            }),
          );

          const counts = await finalize(tx, {
            tables,
            checkpoint: event.checkpoint,
          });

          for (const [index, table] of tables.entries()) {
            common.logger.info({
              service: "database",
              msg: `Finalized ${counts[index]} operations from '${getTableName(table)}'`,
            });
          }

          const decoded = decodeCheckpoint(event.checkpoint);

          common.logger.debug({
            service: "database",
            msg: `Updated finalized checkpoint to (timestamp=${decoded.blockTimestamp} chainId=${decoded.chainId} block=${decoded.blockNumber})`,
          });
        });

        break;
      default:
        never(event);
    }
  }
}
