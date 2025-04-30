import { runCodegen } from "@/bin/utils/codegen.js";
import { createIndexingCache } from "@/indexing-store/cache.js";
import { createHistoricalIndexingStore } from "@/indexing-store/historical.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import { createCachedViemClient } from "@/indexing/client.js";
import { createIndexing } from "@/indexing/index.js";
import { FlushError } from "@/internal/errors.js";
import { getAppProgress } from "@/internal/metrics.js";
import type { CrashRecoveryCheckpoint, PonderApp } from "@/internal/types.js";
import {
  type RealtimeEvent,
  createSync,
  findChain,
  splitEvents,
} from "@/sync/index.js";
import { decodeCheckpoint } from "@/utils/checkpoint.js";
import { chunk } from "@/utils/chunk.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import { recordAsyncGenerator } from "@/utils/generators.js";
import { createMutex } from "@/utils/mutex.js";
import { never } from "@/utils/never.js";
import { startClock } from "@/utils/timer.js";
import { sql } from "drizzle-orm";

/** Starts the sync and indexing services for the specified build. */
export async function run(
  app: PonderApp,
  {
    crashRecoveryCheckpoint,
    onFatalError,
    onReloadableError,
  }: {
    crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
    onFatalError: (error: Error) => void;
    onReloadableError: (error: Error) => void;
  },
) {
  await app.database.migrateSync();
  runCodegen(app.common);

  const realtimeMutex = createMutex();

  const sync = await createSync(app, {
    onRealtimeEvent: (realtimeEvent) => {
      if (realtimeEvent.type === "reorg") {
        realtimeMutex.clear();
      }
      return onRealtimeEvent(realtimeEvent);
    },
    crashRecoveryCheckpoint,
    onFatalError,
  });

  const eventCount: { [eventName: string]: number } = {};
  // for (const eventName of Object.keys(app.indexingBuild)) {
  //   eventCount[eventName] = 0;
  // }

  const cachedViemClient = createCachedViemClient(app, { eventCount });

  const indexing = createIndexing(app, {
    client: cachedViemClient,
    eventCount,
  });

  const indexingCache = createIndexingCache(app, {
    crashRecoveryCheckpoint,
    eventCount,
  });

  for (const { chain } of app.indexingBuild) {
    const label = { chain: chain.chain.name };
    app.common.metrics.ponder_historical_total_indexing_seconds.set(
      label,
      Math.max(
        sync.seconds[chain.chain.name]!.end -
          sync.seconds[chain.chain.name]!.start,
        0,
      ),
    );
    app.common.metrics.ponder_historical_cached_indexing_seconds.set(
      label,
      Math.max(
        sync.seconds[chain.chain.name]!.cached -
          sync.seconds[chain.chain.name]!.start,
        0,
      ),
    );
    app.common.metrics.ponder_historical_completed_indexing_seconds.set(
      label,
      0,
    );
    app.common.metrics.ponder_indexing_timestamp.set(
      label,
      Math.max(
        sync.seconds[chain.chain.name]!.cached,
        sync.seconds[chain.chain.name]!.start,
      ),
    );
  }

  const startTimestamp = Math.round(Date.now() / 1000);
  app.common.metrics.ponder_historical_start_timestamp_seconds.set(
    startTimestamp,
  );

  // Reset the start timestamp so the eta estimate doesn't include
  // the startup time.
  app.common.metrics.start_timestamp = Date.now();

  // If the initial checkpoint is zero, we need to run setup events.
  if (crashRecoveryCheckpoint === undefined) {
    await app.database.retry(async () => {
      await app.database.transaction(async (client, tx) => {
        const historicalIndexingStore = createHistoricalIndexingStore(app, {
          indexingCache,
          db: tx,
          client,
        });
        const result = await indexing.processSetupEvents({
          db: historicalIndexingStore,
        });

        if (result.status === "error") {
          onReloadableError(result.error);
          return;
        }
      });
    });
  }

  await app.database.setCheckpoints({
    checkpoints: app.indexingBuild.map(({ chain }) => ({
      chainName: chain.chain.name,
      chainId: chain.chain.id,
      latestCheckpoint: sync.getStartCheckpoint(chain),
      safeCheckpoint: sync.getStartCheckpoint(chain),
    })),
    db: app.database.qb.drizzle,
  });

  // Run historical indexing until complete.
  for await (const events of recordAsyncGenerator(
    sync.getEvents(),
    (params) => {
      app.common.metrics.ponder_historical_concurrency_group_duration.inc(
        { group: "extract" },
        params.await,
      );
      app.common.metrics.ponder_historical_concurrency_group_duration.inc(
        { group: "transform" },
        params.yield,
      );
    },
  )) {
    let endClock = startClock();

    await Promise.all([
      indexingCache.prefetch({
        events: events.events,
        db: app.database.qb.drizzle,
      }),
      cachedViemClient.prefetch({
        events: events.events,
      }),
    ]);
    app.common.metrics.ponder_historical_transform_duration.inc(
      { step: "prefetch" },
      endClock(),
    );
    if (events.events.length > 0) {
      endClock = startClock();
      await app.database.retry(async () => {
        await app.database
          .transaction(async (client, tx) => {
            app.common.metrics.ponder_historical_transform_duration.inc(
              { step: "begin" },
              endClock(),
            );

            endClock = startClock();
            const historicalIndexingStore = createHistoricalIndexingStore(app, {
              indexingCache,
              db: tx,
              client,
            });

            const eventChunks = chunk(events.events, 93);
            for (const eventChunk of eventChunks) {
              const result = await indexing.processEvents({
                events: eventChunk,
                db: historicalIndexingStore,
                cache: indexingCache,
              });

              if (result.status === "error") {
                onReloadableError(result.error);
                return;
              }

              const checkpoint = decodeCheckpoint(
                eventChunk[eventChunk.length - 1]!.checkpoint,
              );

              if (app.preBuild.ordering === "multichain") {
                const chain = findChain(app, checkpoint);
                app.common.metrics.ponder_historical_completed_indexing_seconds.set(
                  { chain: chain.chain.name },
                  Math.max(
                    Number(checkpoint.blockTimestamp) -
                      sync.seconds[chain.chain.name]!.start -
                      sync.seconds[chain.chain.name]!.cached,
                    0,
                  ),
                );
                app.common.metrics.ponder_indexing_timestamp.set(
                  { chain: chain.chain.name },
                  Number(checkpoint.blockTimestamp),
                );
              } else {
                // TODO(kyle) does this handle chains with end blocks?
                for (const { chain } of app.indexingBuild) {
                  app.common.metrics.ponder_historical_completed_indexing_seconds.set(
                    { chain: chain.chain.name },
                    Math.max(
                      Number(checkpoint.blockTimestamp) -
                        sync.seconds[chain.chain.name]!.start -
                        sync.seconds[chain.chain.name]!.cached,
                      0,
                    ),
                  );
                  app.common.metrics.ponder_indexing_timestamp.set(
                    { chain: chain.chain.name },
                    Number(checkpoint.blockTimestamp),
                  );
                }
              }

              // Note: allows for terminal and logs to be updated
              if (app.preBuild.databaseConfig.kind === "pglite") {
                await new Promise(setImmediate);
              }
            }
            await new Promise(setImmediate);

            // underlying metrics collection is actually synchronous
            // https://github.com/siimon/prom-client/blob/master/lib/histogram.js#L102-L125
            const { eta, progress } = await getAppProgress(app.common.metrics);
            if (eta === undefined || progress === undefined) {
              app.common.logger.info({
                service: "app",
                msg: `Indexed ${events.events.length} events`,
              });
            } else {
              app.common.logger.info({
                service: "app",
                msg: `Indexed ${events.events.length} events with ${formatPercentage(progress)} complete and ${formatEta(eta * 1_000)} remaining`,
              });
            }

            app.common.metrics.ponder_historical_transform_duration.inc(
              { step: "index" },
              endClock(),
            );

            endClock = startClock();
            // Note: at this point, the next events can be preloaded, as long as the are not indexed until
            // the "flush" + "finalize" is complete.

            try {
              await indexingCache.flush({ client });
            } catch (error) {
              if (error instanceof FlushError) {
                onReloadableError(error as Error);
                return;
              }
              throw error;
            }

            app.common.metrics.ponder_historical_transform_duration.inc(
              { step: "load" },
              endClock(),
            );
            endClock = startClock();

            await app.database.setCheckpoints({
              checkpoints: events.checkpoints.map(
                ({ chainId, checkpoint }) => ({
                  chainName: findChain(app, checkpoint).chain.name,
                  chainId,
                  latestCheckpoint: checkpoint,
                  safeCheckpoint: checkpoint,
                }),
              ),
              db: tx,
            });

            app.common.metrics.ponder_historical_transform_duration.inc(
              { step: "finalize" },
              endClock(),
            );
            endClock = startClock();
          })
          .catch((error) => {
            indexingCache.rollback();
            throw error;
          });
      });
      cachedViemClient.clear();
      app.common.metrics.ponder_historical_transform_duration.inc(
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

  for (const { chain } of app.indexingBuild) {
    const label = { chain: chain.chain.name };
    app.common.metrics.ponder_historical_completed_indexing_seconds.set(
      label,
      Math.max(
        sync.seconds[chain.chain.name]!.end -
          sync.seconds[chain.chain.name]!.start -
          sync.seconds[chain.chain.name]!.cached,
        0,
      ),
    );
    app.common.metrics.ponder_indexing_timestamp.set(
      { chain: chain.chain.name },
      sync.seconds[chain.chain.name]!.end,
    );
  }

  const endTimestamp = Math.round(Date.now() / 1000);
  app.common.metrics.ponder_historical_end_timestamp_seconds.set(endTimestamp);

  app.common.logger.info({
    service: "indexing",
    msg: "Completed historical indexing",
  });

  await app.database.setCheckpoints({
    checkpoints: app.indexingBuild.map(({ chain }) => ({
      chainName: chain.chain.name,
      chainId: chain.chain.id,
      latestCheckpoint: sync.getFinalizedCheckpoint(chain),
      safeCheckpoint: sync.getFinalizedCheckpoint(chain),
    })),
    db: app.database.qb.drizzle,
  });

  await app.database.setReady();

  const realtimeIndexingStore = createRealtimeIndexingStore(app);

  const onRealtimeEvent = realtimeMutex(async (event: RealtimeEvent) => {
    switch (event.type) {
      case "block": {
        if (event.events.length > 0) {
          // Events must be run block-by-block, so that `database.commitBlock` can accurately
          // update the temporary `checkpoint` value set in the trigger.

          const perBlockEvents = splitEvents(event.events);

          app.common.logger.debug({
            service: "app",
            msg: `Partitioned events into ${perBlockEvents.length} blocks`,
          });

          for (const { checkpoint, events } of perBlockEvents) {
            const chain = findChain(app, checkpoint);

            const result = await indexing.processEvents({
              events,
              db: realtimeIndexingStore,
            });

            app.common.logger.info({
              service: "app",
              msg: `Indexed ${events.length} '${chain.chain.name}' events for block ${Number(decodeCheckpoint(checkpoint).blockNumber)}`,
            });

            if (result.status === "error") onReloadableError(result.error);

            await app.database.commitBlock({
              checkpoint,
              db: app.database.qb.drizzle,
            });

            if (app.preBuild.ordering === "multichain") {
              app.common.metrics.ponder_indexing_timestamp.set(
                { chain: chain.chain.name },
                Number(decodeCheckpoint(checkpoint).blockTimestamp),
              );
            } else {
              for (const { chain } of app.indexingBuild) {
                app.common.metrics.ponder_indexing_timestamp.set(
                  { chain: chain.chain.name },
                  Number(decodeCheckpoint(checkpoint).blockTimestamp),
                );
              }
            }
          }
        }

        // TODO(kyle) wrap
        await app.database.qb.drizzle
          .insert(app.database.PONDER_CHECKPOINT)
          .values(
            event.checkpoints.map(({ chainId, checkpoint }) => ({
              chainName: findChain(app, checkpoint).chain.name,
              chainId,
              safeCheckpoint: checkpoint,
              latestCheckpoint: checkpoint,
            })),
          )
          .onConflictDoUpdate({
            target: app.database.PONDER_CHECKPOINT.chainName,
            set: {
              latestCheckpoint: sql`excluded.latest_checkpoint`,
            },
          });

        break;
      }
      case "reorg":
        // Note: `setLatestCheckpoint` is not called here, instead it is called
        // in the `block` case.

        await app.database.removeTriggers();
        await app.database.retry(async () => {
          await app.database.qb.drizzle.transaction(async (tx) => {
            await app.database.revert({ checkpoint: event.checkpoint, tx });
          });
        });
        await app.database.createTriggers();

        break;

      case "finalize":
        await app.database.qb.drizzle
          .update(app.database.PONDER_CHECKPOINT)
          .set({
            safeCheckpoint: event.checkpoint,
          });

        await app.database.finalize({
          checkpoint: event.checkpoint,
          db: app.database.qb.drizzle,
        });
        break;

      default:
        never(event);
    }
  });

  await app.database.createIndexes();
  await app.database.createTriggers();

  await sync.startRealtime();

  app.common.logger.info({
    service: "server",
    msg: "Started returning 200 responses from /ready endpoint",
  });
}
