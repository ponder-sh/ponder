import { runCodegen } from "@/bin/utils/codegen.js";
import type { Database } from "@/database/index.js";
import { createIndexingCache } from "@/indexing-store/cache.js";
import { createHistoricalIndexingStore } from "@/indexing-store/historical.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import { createCachedViemClient } from "@/indexing/client.js";
import { createIndexing } from "@/indexing/index.js";
import type { Common } from "@/internal/common.js";
import { FlushError } from "@/internal/errors.js";
import { getAppProgress } from "@/internal/metrics.js";
import type {
  Chain,
  CrashRecoveryCheckpoint,
  Event,
  IndexingBuild,
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
  Seconds,
} from "@/internal/types.js";
import type { RealtimeSyncEvent } from "@/sync-realtime/index.js";
import { createSyncStore } from "@/sync-store/index.js";
import {
  buildEvents,
  decodeEvents,
  syncBlockToInternal,
  syncLogToInternal,
  syncTraceToInternal,
  syncTransactionReceiptToInternal,
  syncTransactionToInternal,
} from "@/sync/events.js";
import { type RealtimeEvent, type Sync, createSync } from "@/sync/index.js";
import {
  type EventGenerator,
  blockToCheckpoint,
  mergeAsyncGeneratorsWithEventOrder,
  splitEvents,
} from "@/sync/utils.js";
import {
  ZERO_CHECKPOINT_STRING,
  decodeCheckpoint,
  encodeCheckpoint,
  min,
} from "@/utils/checkpoint.js";
import { chunk } from "@/utils/chunk.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import {
  mapAsyncGenerator,
  mergeAsyncGenerators,
  recordAsyncGenerator,
} from "@/utils/generators.js";
import { mutex } from "@/utils/mutex.js";
import { never } from "@/utils/never.js";
import { partition } from "@/utils/partition.js";
import { promiseWithResolvers } from "@/utils/promiseWithResolvers.js";
import { startClock } from "@/utils/timer.js";
import { type TableConfig, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import { hexToNumber } from "viem";

/** Starts the sync and indexing services for the specified build. */
export async function run({
  common,
  preBuild,
  namespaceBuild,
  schemaBuild,
  indexingBuild,
  crashRecoveryCheckpoint,
  database,
  onFatalError,
  onReloadableError,
}: {
  common: Common;
  preBuild: PreBuild;
  namespaceBuild: NamespaceBuild;
  schemaBuild: SchemaBuild;
  indexingBuild: IndexingBuild;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  database: Database;
  onFatalError: (error: Error) => void;
  onReloadableError: (error: Error) => void;
}) {
  await database.migrateSync();

  runCodegen({ common });

  const syncStore = createSyncStore({ common, database });

  async function* getEvents() {
    const to = min(
      sync.getOmnichainCheckpoint({ tag: "finalized" }),
      sync.getOmnichainCheckpoint({ tag: "end" }),
    );

    async function* sortCompletedAndPendingEvents(
      eventGenerator: AsyncGenerator<{
        events: Event[];
        checkpoint: string;
      }>,
    ) {
      for await (const { events, checkpoint } of eventGenerator) {
        // Sort out any events between the omnichain finalized checkpoint and the single-chain
        // finalized checkpoint and add them to pendingEvents. These events are synced during
        // the historical phase, but must be indexed in the realtime phase because events
        // synced in realtime on other chains might be ordered before them.
        if (checkpoint > to) {
          const [left, right] = partition(
            events,
            (event) => event.checkpoint <= to,
          );
          realtimeState.pendingEvents =
            realtimeState.pendingEvents.concat(right);
          yield { events: left, checkpoint: to };
        } else {
          yield { events, checkpoint };
        }
      }
    }

    const eventGenerators = (await sync.getEventGenerators()).map((e) =>
      sortCompletedAndPendingEvents(e),
    );

    let eventGenerator: EventGenerator;
    if (preBuild.ordering === "multichain") {
      eventGenerator = mapAsyncGenerator(
        mergeAsyncGenerators(eventGenerators),
        ({ events, checkpoint }) => {
          return {
            events,
            checkpoints: [
              {
                chainId: Number(decodeCheckpoint(checkpoint).chainId),
                checkpoint,
              },
            ],
          };
        },
      );
    } else {
      eventGenerator = mergeAsyncGeneratorsWithEventOrder(eventGenerators);
    }

    for await (const { events, checkpoints } of eventGenerator) {
      common.logger.debug({
        service: "sync",
        msg: `Sequenced ${events.length} events`,
      });

      yield { events, checkpoints };
    }
  }

  const realtimeState = {
    /** Events that have been executed but not finalized. */
    executedEvents: [] as Event[],
    /** Events that have not been executed. */
    pendingEvents: [] as Event[],
    checkpoints: {
      // Note: `checkpoints.current` not used in multichain ordering
      current: ZERO_CHECKPOINT_STRING,
      finalized: ZERO_CHECKPOINT_STRING,
    },
    // Note: `omnichainCheckpointHooks` not used in multichain ordering
    omnichainHooks: [] as {
      checkpoint: string;
      callback: () => void;
    }[],
    onBlock: async (
      event: Extract<RealtimeSyncEvent, { type: "block" }>,
      chain: Chain,
    ): Promise<void> => {
      const events = buildEvents({
        sources,
        chainId: chain.id,
        blockData: {
          block: syncBlockToInternal({ block: event.block }),
          logs: event.logs.map((log) => syncLogToInternal({ log })),
          transactions: event.transactions.map((transaction) =>
            syncTransactionToInternal({ transaction }),
          ),
          transactionReceipts: event.transactionReceipts.map(
            (transactionReceipt) =>
              syncTransactionReceiptToInternal({ transactionReceipt }),
          ),
          traces: event.traces.map((trace) =>
            syncTraceToInternal({
              trace,
              block: event.block,
              transaction: event.transactions.find(
                (t) => t.hash === trace.transactionHash,
              )!,
            }),
          ),
        },
        childAddresses: realtimeSync!.childAddresses,
      });

      common.logger.debug({
        service: "sync",
        msg: `Extracted ${events.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
      });

      const decodedEvents = decodeEvents(common, sources, events);
      common.logger.debug({
        service: "sync",
        msg: `Decoded ${decodedEvents.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
      });

      if (preBuild.ordering === "multichain") {
        // Note: `checkpoints.current` not used in multichain ordering
        const checkpoint = sync.getMultichainCheckpoint({
          tag: "current",
          chainId: chain.id,
        });

        const readyEvents = decodedEvents
          .concat(realtimeState.pendingEvents)
          .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
        realtimeState.pendingEvents = [];
        realtimeState.executedEvents =
          realtimeState.executedEvents.concat(readyEvents);

        common.logger.debug({
          service: "sync",
          msg: `Sequenced ${readyEvents.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
        });

        await onRealtimeEvent({
          type: "block",
          events: readyEvents,
          checkpoints: [{ chainId: chain.id, checkpoint }],
        });
      } else {
        const from = realtimeState.checkpoints.current;
        realtimeState.checkpoints.current = sync.getOmnichainCheckpoint({
          tag: "current",
        });
        const to = sync.getOmnichainCheckpoint({ tag: "current" });

        const pwr = promiseWithResolvers<void>();
        realtimeState.omnichainHooks.push({
          checkpoint: encodeCheckpoint(
            blockToCheckpoint(event.block, chain.id, "down"),
          ),
          callback: () => pwr.resolve(),
        });

        if (to <= from) {
          realtimeState.pendingEvents =
            realtimeState.pendingEvents.concat(decodedEvents);

          return pwr.promise;
        }

        if (to > from) {
          // Move ready events from pending to executed
          const readyEvents = realtimeState.pendingEvents
            .concat(decodedEvents)
            .filter(({ checkpoint }) => checkpoint < to)
            .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
          realtimeState.pendingEvents = realtimeState.pendingEvents
            .concat(decodedEvents)
            .filter(({ checkpoint }) => checkpoint > to);
          realtimeState.executedEvents =
            realtimeState.executedEvents.concat(readyEvents);

          common.logger.debug({
            service: "sync",
            msg: `Sequenced ${readyEvents.length} events`,
          });

          const checkpoints: { chainId: number; checkpoint: string }[] = [];
          for (const chain of indexingBuild.chains) {
            const localBlock = perChainSync
              .get(chain.id)!
              .realtimeSync!.unfinalizedBlocks.findLast((block) => {
                const checkpoint = encodeCheckpoint(
                  blockToCheckpoint(block, chain.id, "up"),
                );
                return checkpoint > from && checkpoint <= to;
              });

            if (localBlock) {
              const checkpoint = encodeCheckpoint(
                blockToCheckpoint(localBlock, chain.id, "up"),
              );

              checkpoints.push({ chainId: chain.id, checkpoint });
            }
          }

          await onRealtimeEvent({
            type: "block",
            events: readyEvents,
            checkpoints,
          });

          const completedHooks = realtimeState.omnichainHooks.filter(
            ({ checkpoint }) => checkpoint > from && checkpoint <= to,
          );
          realtimeState.omnichainHooks = realtimeState.omnichainHooks.filter(
            ({ checkpoint }) =>
              (checkpoint > from && checkpoint <= to) === false,
          );
          for (const { callback } of completedHooks) {
            callback();
          }
        } else {
          realtimeState.pendingEvents =
            realtimeState.pendingEvents.concat(decodedEvents);

          return pwr.promise;
        }

        return pwr.promise;
      }

      return;
    },
    onFinalize: async (
      _: Extract<RealtimeSyncEvent, { type: "finalize" }>,
      chain: Chain,
    ): Promise<void> => {
      const from = realtimeState.checkpoints.finalized;
      realtimeState.checkpoints.finalized = sync.getOmnichainCheckpoint({
        tag: "finalized",
      });
      const to = sync.getOmnichainCheckpoint({ tag: "finalized" });

      if (
        preBuild.ordering === "omnichain" &&
        sync.getMultichainCheckpoint({
          chainId: chain.id,
          tag: "finalized",
        }) > sync.getOmnichainCheckpoint({ tag: "current" })
      ) {
        const chainId = Number(
          decodeCheckpoint(sync.getOmnichainCheckpoint({ tag: "current" }))
            .chainId,
        );
        const chain = indexingBuild.chains.find(
          (chain) => chain.id === chainId,
        )!;
        common.logger.warn({
          service: "sync",
          msg: `'${chain.name}' is lagging behind other chains`,
        });
      }

      if (to <= from) {
        return;
      }

      // index of the first unfinalized event
      let finalizeIndex: number | undefined = undefined;
      for (const [index, event] of realtimeState.executedEvents.entries()) {
        if (event.checkpoint > to) {
          finalizeIndex = index;
          break;
        }
      }

      let finalizedEvents: Event[];

      if (finalizeIndex === undefined) {
        finalizedEvents = realtimeState.executedEvents;
        realtimeState.executedEvents = [];
      } else {
        finalizedEvents = realtimeState.executedEvents.slice(0, finalizeIndex);
        realtimeState.executedEvents =
          realtimeState.executedEvents.slice(finalizeIndex);
      }

      // Raise event to parent function (runtime)
      onRealtimeEvent({ type: "finalize", checkpoint: to });

      common.logger.debug({
        service: "sync",
        msg: `Finalized ${finalizedEvents.length} executed events`,
      });
    },
    onReorg: async (
      event: Extract<RealtimeSyncEvent, { type: "reorg" }>,
      chain: Chain,
    ): Promise<void> => {
      const isReorgedEvent = (_event: Event) => {
        if (
          _event.chainId === chain.id &&
          Number(_event.event.block.number) > hexToNumber(event.block.number)
        ) {
          return true;
        }
        return false;
      };

      if (preBuild.ordering === "multichain") {
        // Note: `checkpoints.current` not used in multichain ordering
        const checkpoint = sync.getMultichainCheckpoint({
          tag: "current",
          chainId: chain.id,
        });

        // index of the first reorged event
        let reorgIndex: number | undefined = undefined;
        for (const [index, event] of realtimeState.executedEvents.entries()) {
          if (event.chainId === chain.id && event.checkpoint > checkpoint) {
            reorgIndex = index;
            break;
          }
        }

        if (reorgIndex === undefined) {
          return;
        }

        // Move events from executed to pending

        const reorgedEvents = realtimeState.executedEvents.slice(reorgIndex);
        realtimeState.executedEvents = realtimeState.executedEvents.slice(
          0,
          reorgIndex,
        );
        realtimeState.pendingEvents =
          realtimeState.pendingEvents.concat(reorgedEvents);

        common.logger.debug({
          service: "sync",
          msg: `Rescheduled ${reorgedEvents.length} reorged events`,
        });

        onRealtimeEvent({ type: "reorg", checkpoint });

        realtimeState.pendingEvents = realtimeState.pendingEvents.filter(
          (e) => isReorgedEvent(e) === false,
        );
      } else {
        const from = realtimeState.checkpoints.current;
        realtimeState.checkpoints.current = sync.getOmnichainCheckpoint({
          tag: "current",
        });
        const to = sync.getOmnichainCheckpoint({ tag: "current" });

        if (to >= from) {
          return;
        }

        // Move events from executed to pending

        const reorgedEvents = realtimeState.executedEvents.filter(
          (e) => e.checkpoint > to,
        );
        realtimeState.executedEvents = realtimeState.executedEvents.filter(
          (e) => e.checkpoint < to,
        );
        realtimeState.pendingEvents =
          realtimeState.pendingEvents.concat(reorgedEvents);

        common.logger.debug({
          service: "sync",
          msg: `Rescheduled ${reorgedEvents.length} reorged events`,
        });

        onRealtimeEvent({ type: "reorg", checkpoint: to });

        realtimeState.pendingEvents = realtimeState.pendingEvents.filter(
          (e) => isReorgedEvent(e) === false,
        );
      }
    },
  };

  const sync = await createSync({
    common,
    indexingBuild,
    syncStore,
    onRealtimeSyncEvent: async (event, chain) => {
      switch (event.type) {
        case "block":
          return realtimeState.onBlock(event, chain);
        case "finalize":
          return realtimeState.onFinalize(event, chain);
        case "reorg":
          return realtimeState.onReorg(event, chain);
      }
    },
    onFatalError,
    crashRecoveryCheckpoint,
  });

  const seconds: Seconds = {};
  for (const chain of indexingBuild.chains) {
    const crashRecoveryCheckpoint_ = crashRecoveryCheckpoint?.find(
      ({ chainId }) => chainId === chain.id,
    )?.checkpoint;
    seconds[chain.name] = {
      start: Number(
        decodeCheckpoint(sync.getOmnichainCheckpoint({ tag: "start" }))
          .blockTimestamp,
      ),
      end: Number(
        decodeCheckpoint(
          min(
            sync.getOmnichainCheckpoint({ tag: "end" }),
            sync.getOmnichainCheckpoint({ tag: "finalized" }),
          ),
        ).blockTimestamp,
      ),
      cached: Number(
        decodeCheckpoint(
          min(
            sync.getOmnichainCheckpoint({ tag: "end" }),
            sync.getOmnichainCheckpoint({ tag: "finalized" }),
            crashRecoveryCheckpoint_ ?? ZERO_CHECKPOINT_STRING,
          ),
        ).blockTimestamp,
      ),
    };
  }

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

  const indexing = createIndexing({
    common,
    indexingBuild,
    client: cachedViemClient,
    eventCount,
  });

  const indexingCache = createIndexingCache({
    common,
    schemaBuild,
    crashRecoveryCheckpoint,
    eventCount,
  });

  for (const chain of indexingBuild.chains) {
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
  }

  const startTimestamp = Math.round(Date.now() / 1000);
  common.metrics.ponder_historical_start_timestamp_seconds.set(startTimestamp);

  // Reset the start timestamp so the eta estimate doesn't include
  // the startup time.
  common.metrics.start_timestamp = Date.now();

  // If the initial checkpoint is zero, we need to run setup events.
  if (crashRecoveryCheckpoint === undefined) {
    await database.retry(async () => {
      await database.transaction(async (client, tx) => {
        const historicalIndexingStore = createHistoricalIndexingStore({
          common,
          schemaBuild,
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

        try {
          await indexingCache.flush({ client });
        } catch (error) {
          if (error instanceof FlushError) {
            onReloadableError(error as Error);
            return;
          }
          throw error;
        }
      });
    });

    // Note: `_ponder_checkpoint` must be updated after the setup events are processed.
    await database.setCheckpoints({
      checkpoints: indexingBuild.chains.map((chain) => ({
        chainName: chain.name,
        chainId: chain.id,
        latestCheckpoint: sync.getMultichainCheckpoint({
          tag: "start",
          chainId: chain.id,
        }),
        safeCheckpoint: sync.getMultichainCheckpoint({
          tag: "start",
          chainId: chain.id,
        }),
      })),
      db: database.qb.drizzle,
    });
  }

  // Run historical indexing until complete.
  for await (const events of recordAsyncGenerator(getEvents(), (params) => {
    common.metrics.ponder_historical_concurrency_group_duration.inc(
      { group: "extract" },
      params.await,
    );
    common.metrics.ponder_historical_concurrency_group_duration.inc(
      { group: "transform" },
      params.yield,
    );
  })) {
    let endClock = startClock();

    await Promise.all([
      indexingCache.prefetch({
        events: events.events,
        db: database.qb.drizzle,
      }),
      cachedViemClient.prefetch({
        events: events.events,
      }),
    ]);
    common.metrics.ponder_historical_transform_duration.inc(
      { step: "prefetch" },
      endClock(),
    );
    if (events.events.length > 0) {
      endClock = startClock();
      await database.retry(async () => {
        await database
          .transaction(async (client, tx) => {
            common.metrics.ponder_historical_transform_duration.inc(
              { step: "begin" },
              endClock(),
            );

            endClock = startClock();
            const historicalIndexingStore = createHistoricalIndexingStore({
              common,
              schemaBuild,
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

              if (preBuild.ordering === "multichain") {
                const chain = indexingBuild.chains.find(
                  (chain) => chain.id === Number(checkpoint.chainId),
                )!;
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
              } else {
                for (const chain of indexingBuild.chains) {
                  common.metrics.ponder_historical_completed_indexing_seconds.set(
                    { chain: chain.name },
                    Math.min(
                      Math.max(
                        Number(checkpoint.blockTimestamp) -
                          Math.max(
                            seconds[chain.name]!.cached,
                            seconds[chain.name]!.start,
                          ),
                        0,
                      ),
                      Math.max(
                        seconds[chain.name]!.end - seconds[chain.name]!.start,
                        0,
                      ),
                    ),
                  );
                  common.metrics.ponder_indexing_timestamp.set(
                    { chain: chain.name },
                    Math.max(
                      Number(checkpoint.blockTimestamp),
                      seconds[chain.name]!.end,
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

            try {
              await indexingCache.flush({ client });
            } catch (error) {
              if (error instanceof FlushError) {
                onReloadableError(error as Error);
                return;
              }
              throw error;
            }

            common.metrics.ponder_historical_transform_duration.inc(
              { step: "load" },
              endClock(),
            );
            endClock = startClock();

            await database.setCheckpoints({
              checkpoints: events.checkpoints.map(
                ({ chainId, checkpoint }) => ({
                  chainName: indexingBuild.chains.find(
                    (chain) => chain.id === chainId,
                  )!.name,
                  chainId,
                  latestCheckpoint: checkpoint,
                  safeCheckpoint: checkpoint,
                }),
              ),
              db: tx,
            });

            common.metrics.ponder_historical_transform_duration.inc(
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
        seconds[chain.name]!.end -
          Math.max(seconds[chain.name]!.cached, seconds[chain.name]!.start),
        0,
      ),
    );
    common.metrics.ponder_indexing_timestamp.set(
      { chain: chain.name },
      seconds[chain.name]!.end,
    );
  }

  const endTimestamp = Math.round(Date.now() / 1000);
  common.metrics.ponder_historical_end_timestamp_seconds.set(endTimestamp);

  common.logger.info({
    service: "indexing",
    msg: "Completed historical indexing",
  });

  await database.createIndexes();
  await database.createTriggers();

  if (namespaceBuild.viewsSchema) {
    await database.wrap({ method: "create-views" }, async () => {
      await database.qb.drizzle.execute(
        sql.raw(`CREATE SCHEMA IF NOT EXISTS "${namespaceBuild.viewsSchema}"`),
      );

      const tables = Object.values(schemaBuild.schema).filter(
        (table): table is PgTableWithColumns<TableConfig> => is(table, PgTable),
      );

      for (const table of tables) {
        // Note: drop views before creating new ones to avoid enum errors.
        await database.qb.drizzle.execute(
          sql.raw(
            `DROP VIEW IF EXISTS "${namespaceBuild.viewsSchema}"."${getTableName(table)}"`,
          ),
        );

        await database.qb.drizzle.execute(
          sql.raw(
            `CREATE VIEW "${namespaceBuild.viewsSchema}"."${getTableName(table)}" AS SELECT * FROM "${namespaceBuild.schema}"."${getTableName(table)}"`,
          ),
        );
      }

      common.logger.info({
        service: "app",
        msg: `Created ${tables.length} views in schema "${namespaceBuild.viewsSchema}"`,
      });

      await database.qb.drizzle.execute(
        sql.raw(
          `CREATE OR REPLACE VIEW "${namespaceBuild.viewsSchema}"."_ponder_meta" AS SELECT * FROM "${namespaceBuild.schema}"."_ponder_meta"`,
        ),
      );

      await database.qb.drizzle.execute(
        sql.raw(
          `CREATE OR REPLACE VIEW "${namespaceBuild.viewsSchema}"."_ponder_checkpoint" AS SELECT * FROM "${namespaceBuild.schema}"."_ponder_checkpoint"`,
        ),
      );

      const trigger = `status_${namespaceBuild.viewsSchema}_trigger`;
      const notification = "status_notify()";
      const channel = `${namespaceBuild.viewsSchema}_status_channel`;

      await database.qb.drizzle.execute(
        sql.raw(`
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

      await database.qb.drizzle.execute(
        sql.raw(`
  CREATE OR REPLACE TRIGGER "${trigger}"
  AFTER INSERT OR UPDATE OR DELETE
  ON "${namespaceBuild.schema}"._ponder_checkpoint
  FOR EACH STATEMENT
  EXECUTE PROCEDURE "${namespaceBuild.viewsSchema}".${notification};`),
      );
    });
  }

  await database.setReady();

  const realtimeIndexingStore = createRealtimeIndexingStore({
    common,
    schemaBuild,
    database,
  });

  // Callback to control indexing and database state
  const onRealtimeEvent = mutex(async (event: RealtimeEvent) => {
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
            const chain = indexingBuild.chains.find(
              (chain) =>
                chain.id === Number(decodeCheckpoint(checkpoint).chainId),
            )!;

            const result = await indexing.processEvents({
              events,
              db: realtimeIndexingStore,
            });

            common.logger.info({
              service: "app",
              msg: `Indexed ${events.length} '${chain.name}' events for block ${Number(decodeCheckpoint(checkpoint).blockNumber)}`,
            });

            if (result.status === "error") onReloadableError(result.error);

            await database.commitBlock({ checkpoint, db: database.qb.drizzle });

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
          }
        }

        await database.wrap({ method: "setCheckpoints" }, async () => {
          if (event.checkpoints.length === 0) return;

          await database.qb.drizzle
            .insert(database.PONDER_CHECKPOINT)
            .values(
              event.checkpoints.map(({ chainId, checkpoint }) => ({
                chainName: indexingBuild.chains.find(
                  (chain) => chain.id === chainId,
                )!.name,
                chainId,
                safeCheckpoint: checkpoint,
                latestCheckpoint: checkpoint,
              })),
            )
            .onConflictDoUpdate({
              target: database.PONDER_CHECKPOINT.chainName,
              set: {
                latestCheckpoint: sql`excluded.latest_checkpoint`,
              },
            });
        });

        break;
      }
      case "reorg":
        // Note: `_ponder_checkpoint` is not called here, instead it is called
        // in the `block` case.

        await database.removeTriggers();
        await database.retry(async () => {
          await database.qb.drizzle.transaction(async (tx) => {
            await database.revert({
              checkpoint: event.checkpoint,
              ordering: preBuild.ordering,
              tx,
            });
          });
        });
        await database.createTriggers();

        break;

      case "finalize":
        await database.qb.drizzle.update(database.PONDER_CHECKPOINT).set({
          safeCheckpoint: event.checkpoint,
        });

        await database.finalize({
          checkpoint: event.checkpoint,
          db: database.qb.drizzle,
        });
        break;

      default:
        never(event);
    }
  });

  sync.startRealtime();

  common.logger.info({
    service: "server",
    msg: "Started returning 200 responses from /ready endpoint",
  });
}
