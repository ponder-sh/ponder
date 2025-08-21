import { isMainThread, parentPort, workerData } from "node:worker_threads";
import type { CliOptions } from "@/bin/ponder.js";
import { createExit } from "@/bin/utils/exit.js";
import { createBuild } from "@/build/index.js";
import type { Config } from "@/config/index.js";
import {
  commitBlock,
  createTriggers,
  dropTriggers,
  finalize,
  revert,
} from "@/database/actions.js";
import {
  type DatabaseInterface,
  createDatabase,
  getPonderCheckpointTable,
} from "@/database/index.js";
import { createIndexingCache } from "@/indexing-store/cache.js";
import { createHistoricalIndexingStore } from "@/indexing-store/historical.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import { createCachedViemClient } from "@/indexing/client.js";
import { createIndexing } from "@/indexing/index.js";
import {
  NonRetryableUserError,
  type RetryableError,
} from "@/internal/errors.js";
import { createLogger } from "@/internal/logger.js";
import {
  type AppProgress,
  MetricsService,
  getAppProgress,
} from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { type Shutdown, createShutdown } from "@/internal/shutdown.js";
import { createTelemetry } from "@/internal/telemetry.js";
import type {
  CrashRecoveryCheckpoint,
  IndexingBuild,
  IndexingErrorHandler,
  NamespaceBuild,
  PreBuild,
  RawIndexingFunctions,
  Schema,
  SchemaBuild,
  Seconds,
} from "@/internal/types.js";
import { createSyncStore } from "@/sync-store/index.js";
import {
  ZERO_CHECKPOINT_STRING,
  decodeCheckpoint,
  min,
} from "@/utils/checkpoint.js";
import { chunk } from "@/utils/chunk.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import { recordAsyncGenerator } from "@/utils/generators.js";
import { never } from "@/utils/never.js";
import { startClock } from "@/utils/timer.js";
import { eq, getTableName, isTable, sql } from "drizzle-orm";
import { splitEvents } from "./events.js";
import { getHistoricalEventsIsolated } from "./historical.js";
import {
  getCachedIntervals,
  getChildAddresses,
  getLocalSyncProgress,
} from "./index.js";
import { getRealtimeEventsIsolated } from "./realtime.js";

const isWorker = isMainThread === false;
let isKilled = false;

if (isWorker && parentPort) {
  const shutdown = createShutdown();
  const metrics = new MetricsService();
  metrics.addListeners();

  parentPort.on("message", async (msg) => {
    if (msg.type === "kill") {
      if (isKilled) return;
      isKilled = true;
      await shutdown.kill();
    }
  });

  try {
    await runIsolated({
      cliOptions: workerData.cliOptions,
      crashRecoveryCheckpoint: workerData.crashRecoveryCheckpoint,
      shutdown,
      metrics,
      chainId: workerData.chainId,
      onReady: async () => {
        parentPort!.postMessage({ type: "ready" });
      },
    });

    parentPort!.postMessage({ type: "done" });
  } catch (err) {
    const error = err as Error;

    parentPort!.postMessage({
      type: "error",
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    });
  }
}

export async function runIsolated({
  cliOptions,
  crashRecoveryCheckpoint,
  shutdown,
  metrics,
  chainId,
  onReady,
}: {
  cliOptions: CliOptions;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  shutdown: Shutdown;
  metrics: MetricsService;
  chainId: number;
  onReady: () => Promise<void>;
}) {
  const options = buildOptions({ cliOptions });

  const logger = createLogger({
    level: options.logLevel,
    mode: options.logFormat,
  });

  const telemetry = createTelemetry({ options, logger, shutdown });
  const common = { options, logger, metrics, telemetry, shutdown };
  createExit({ common, options });

  if (options.version) {
    metrics.ponder_version_info.set(
      {
        version: options.version.version,
        major: options.version.major,
        minor: options.version.minor,
        patch: options.version.patch,
      },
      1,
    );
  }

  const { preBuild, namespaceBuild, schemaBuild, indexingBuild } =
    await (async () => {
      const build = await createBuild({ common, cliOptions });
      const namespaceResult = build.namespaceCompile() as {
        status: "success";
        result: NamespaceBuild;
      };
      const configResult = (await build.executeConfig()) as {
        status: "success";
        result: { config: Config; contentHash: string };
      };
      const schemaResult = (await build.executeSchema()) as {
        status: "success";
        result: { schema: Schema; contentHash: string };
      };
      const preBuildResult = (await build.preCompile(configResult.result)) as {
        status: "success";
        result: PreBuild;
      };
      const preBuild = preBuildResult.result;
      const schemaBuildResult = build.compileSchema({
        ...schemaResult.result,
        ordering: preBuild.ordering,
      }) as { status: "success"; result: SchemaBuild };
      const schemaBuild = schemaBuildResult.result;
      const indexingResult = (await build.executeIndexingFunctions()) as {
        status: "success";
        result: {
          indexingFunctions: RawIndexingFunctions;
          contentHash: string;
        };
      };
      const indexingBuildResult = (await build.compileIndexing({
        configResult: configResult.result,
        schemaResult: schemaResult.result,
        indexingResult: indexingResult.result,
      })) as { status: "success"; result: IndexingBuild };

      return {
        preBuild,
        namespaceBuild: namespaceResult.result,
        schemaBuild,
        indexingBuild: indexingBuildResult.result,
      };
    })();

  options.indexingCacheMaxBytes =
    options.indexingCacheMaxBytes / indexingBuild.chains.length;

  const database: DatabaseInterface = createDatabase({
    common,
    namespace: namespaceBuild,
    preBuild,
    schemaBuild,
  });

  metrics.ponder_settings_info.set(
    {
      ordering: preBuild.ordering,
      database: preBuild.databaseConfig.kind,
      command: cliOptions.command,
    },
    1,
  );

  const syncStore = createSyncStore({ common, database });

  const PONDER_CHECKPOINT = getPonderCheckpointTable(namespaceBuild.schema);

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
    chainId,
  });

  const seconds: Seconds = {};

  const chain = indexingBuild.chains.find((chain) => chain.id === chainId)!;

  const sources = indexingBuild.sources.filter(
    ({ filter }) => filter.chainId === chainId,
  );

  const cachedIntervals = await getCachedIntervals({
    chain,
    sources,
    syncStore,
  });
  const syncProgress = await getLocalSyncProgress({
    common,
    sources,
    chain,
    rpc: indexingBuild.rpcs[indexingBuild.chains.indexOf(chain)]!,
    finalizedBlock:
      indexingBuild.finalizedBlocks[indexingBuild.chains.indexOf(chain)]!,
    cachedIntervals,
  });
  const childAddresses = await getChildAddresses({
    sources,
    syncStore,
  });

  const start = Number(
    decodeCheckpoint(syncProgress.getCheckpoint({ tag: "start" }))
      .blockTimestamp,
  );
  const end = Number(
    decodeCheckpoint(
      min(
        syncProgress.getCheckpoint({ tag: "end" }),
        syncProgress.getCheckpoint({ tag: "finalized" }),
      ),
    ).blockTimestamp,
  );

  const _crashRecoveryCheckpoint = crashRecoveryCheckpoint?.find(
    ({ chainId }) => chainId === chain.id,
  )?.checkpoint;

  const cached = Math.min(
    Number(
      decodeCheckpoint(_crashRecoveryCheckpoint ?? ZERO_CHECKPOINT_STRING)
        .blockTimestamp,
    ),
    end,
  );

  seconds[chain.name] = { start, end, cached };

  const label = { chain: chain.name };
  common.metrics.ponder_historical_total_indexing_seconds.set(
    label,
    Math.max(seconds[chain.name]!.end - seconds[chain.name]!.start, 0),
  );
  common.metrics.ponder_historical_cached_indexing_seconds.set(
    label,
    Math.max(seconds[chain.name]!.cached - seconds[chain.name]!.start, 0),
  );
  common.metrics.ponder_historical_completed_indexing_seconds.set(label, 0);
  common.metrics.ponder_indexing_timestamp.set(
    label,
    Math.max(seconds[chain.name]!.cached, seconds[chain.name]!.start),
  );

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

      await indexing.processSetupEvents({
        db: historicalIndexingStore,
        chain,
      });

      await indexingCache.flush();

      await tx.wrap({ label: "update_checkpoints" }, (tx) =>
        tx
          .insert(PONDER_CHECKPOINT)
          .values({
            chainName: chain.name,
            chainId: chain.id,
            latestCheckpoint: syncProgress.getCheckpoint({ tag: "start" }),
            finalizedCheckpoint: syncProgress.getCheckpoint({ tag: "start" }),
            safeCheckpoint: syncProgress.getCheckpoint({ tag: "start" }),
          })
          .onConflictDoUpdate({
            target: PONDER_CHECKPOINT.chainName,
            set: {
              safeCheckpoint: sql`excluded.safe_checkpoint`,
              finalizedCheckpoint: sql`excluded.finalized_checkpoint`,
              latestCheckpoint: sql`excluded.latest_checkpoint`,
            },
          }),
      );
    });
  }

  // Run historical indexing until complete.
  for await (const events of recordAsyncGenerator(
    getHistoricalEventsIsolated({
      common,
      indexingBuild,
      crashRecoveryCheckpoint,
      syncProgress,
      chain,
      childAddresses,
      cachedIntervals,
      syncStore,
    }),
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
            await indexing.processEvents({
              events: eventChunk,
              db: historicalIndexingStore,
              cache: indexingCache,
            });

            const checkpoint = decodeCheckpoint(
              eventChunk[eventChunk.length - 1]!.checkpoint,
            );

            common.metrics.ponder_historical_completed_indexing_seconds.set(
              { chain: chain.name },
              Math.max(
                Number(checkpoint.blockTimestamp) -
                  Math.max(
                    seconds[chain.name]!.cached,
                    seconds[chain.name]!.start,
                  ),
                0,
              ),
            );
            common.metrics.ponder_indexing_timestamp.set(
              { chain: chain.name },
              Number(checkpoint.blockTimestamp),
            );

            // Note: allows for terminal and logs to be updated
            if (preBuild.databaseConfig.kind === "pglite") {
              await new Promise(setImmediate);
            }
          }
          await new Promise(setImmediate);

          // underlying metrics collection is actually synchronous
          // https://github.com/siimon/prom-client/blob/master/lib/histogram.js#L102-L125
          const { eta, progress } = (await getAppProgress(
            common.metrics,
          )) as AppProgress;
          if (eta === undefined || progress === undefined) {
            common.logger.info({
              service: "app",
              msg: `Indexed ${events.events.length} '${chain.name}' events`,
            });
          } else {
            common.logger.info({
              service: "app",
              msg: `Indexed ${events.events.length} '${chain.name}' events with ${formatPercentage(progress)} complete and ${formatEta(eta * 1_000)} remaining`,
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

          await tx.wrap({ label: "update_checkpoints" }, (tx) =>
            tx
              .insert(PONDER_CHECKPOINT)
              .values({
                chainName: chain.name,
                chainId: chain.id,
                latestCheckpoint: events.checkpoint,
                finalizedCheckpoint: events.checkpoint,
                safeCheckpoint: events.checkpoint,
              })
              .onConflictDoUpdate({
                target: PONDER_CHECKPOINT.chainName,
                set: {
                  safeCheckpoint: sql`excluded.safe_checkpoint`,
                  finalizedCheckpoint: sql`excluded.finalized_checkpoint`,
                  latestCheckpoint: sql`excluded.latest_checkpoint`,
                },
              }),
          );

          common.metrics.ponder_historical_transform_duration.inc(
            { step: "finalize" },
            endClock(),
          );
          endClock = startClock();
        } catch (error) {
          indexingCache.invalidate();
          indexingCache.clear();

          if (error instanceof NonRetryableUserError === false) {
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

  common.metrics.ponder_historical_completed_indexing_seconds.set(
    label,
    Math.max(
      seconds[chain.name]!.end -
        Math.max(seconds[chain.name]!.cached, seconds[chain.name]!.start),
      0,
    ),
  );
  common.metrics.ponder_indexing_timestamp.set(label, seconds[chain.name]!.end);

  const tables = Object.values(schemaBuild.schema).filter(isTable);
  await createTriggers(database.adminQB, { tables, chainId });

  const endTimestamp = Math.round(Date.now() / 1000);
  common.metrics.ponder_historical_end_timestamp_seconds.set(endTimestamp);

  await onReady();

  const realtimeIndexingStore = createRealtimeIndexingStore({
    common,
    schemaBuild,
    indexingErrorHandler,
    chainId,
  });

  for await (const event of getRealtimeEventsIsolated({
    common,
    indexingBuild,
    syncProgress,
    chain,
    childAddresses,
    syncStore,
    pendingEvents: [],
  })) {
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
              try {
                realtimeIndexingStore.qb = tx;

                await indexing.processEvents({
                  events,
                  db: realtimeIndexingStore,
                });

                common.logger.info({
                  service: "app",
                  msg: `Indexed ${events.length} '${chain.name}' events for block ${Number(decodeCheckpoint(checkpoint).blockNumber)}`,
                });

                await Promise.all(
                  tables.map((table) =>
                    commitBlock(tx, {
                      table,
                      checkpoint,
                      preBuild,
                    }),
                  ),
                );

                common.metrics.ponder_indexing_timestamp.set(
                  { chain: chain.name },
                  Number(decodeCheckpoint(checkpoint).blockTimestamp),
                );
              } catch (error) {
                if (error instanceof NonRetryableUserError === false) {
                  common.logger.warn({
                    service: "app",
                    msg: `Retrying '${chain.name}' events for block ${Number(decodeCheckpoint(checkpoint).blockNumber)}`,
                  });
                }

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
          await dropTriggers(tx, { tables, chainId });

          const counts = await revert(tx, {
            tables,
            checkpoint: event.checkpoint,
            preBuild,
          });

          for (const [index, table] of tables.entries()) {
            common.logger.info({
              service: "database",
              msg: `Reverted ${counts[index]} unfinalized operations from '${getTableName(table)}'`,
            });
          }

          await createTriggers(tx, { tables, chainId });
        });

        break;
      case "finalize": {
        const count = await finalize(database.userQB, {
          checkpoint: event.checkpoint,
          tables,
          preBuild,
          namespaceBuild,
        });

        common.logger.info({
          service: "database",
          msg: `Finalized ${count} operations.`,
        });

        break;
      }
      default:
        never(event);
    }
  }
}
