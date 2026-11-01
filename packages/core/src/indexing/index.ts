import util from "node:util";
import { Clock, Effect, Result } from "effect";
import type { Abi, Address } from "viem";
import type { CachedViemClient } from "@/indexing/client.js";
import type { IndexingCache } from "@/indexing-store/cache.js";
import type { IndexingStore } from "@/indexing-store/index.js";
import {
  BaseError,
  IndexingFunctionError,
  InvalidEventAccessError,
} from "@/internal/errors.js";
import { Metrics } from "@/internal/metrics.js";
import { Options } from "@/internal/options.js";
import type {
  Chain,
  Contract,
  Event,
  Filter,
  IndexingBuild,
  IndexingErrorHandler,
  Schema,
  SetupEvent,
  UserBlock,
  UserLog,
  UserTrace,
  UserTransaction,
} from "@/internal/types.js";
import {
  defaultBlockFilterInclude,
  defaultBlockInclude,
  defaultLogFilterInclude,
  defaultTraceFilterInclude,
  defaultTraceInclude,
  defaultTransactionFilterInclude,
  defaultTransactionInclude,
  defaultTransactionReceiptInclude,
  defaultTransferFilterInclude,
  requiredBlockFilterInclude,
  requiredLogFilterInclude,
  requiredTraceFilterInclude,
  requiredTransactionFilterInclude,
  requiredTransactionReceiptInclude,
  requiredTransferFilterInclude,
} from "@/runtime/filter.js";
import type { Db } from "@/types/db.js";
import type {
  Block,
  Trace,
  Transaction,
  TransactionReceipt,
} from "@/types/eth.js";
import type { DeepPartial } from "@/types/utils.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  ZERO_CHECKPOINT,
} from "@/utils/checkpoint.js";
import { dedupe } from "@/utils/dedupe.js";
import { prettyPrint } from "@/utils/print.js";
import { startClockEffect } from "@/utils/timer.js";
import { addStackTrace } from "./addStackTrace.js";
import type { ReadonlyClient } from "./client.js";

declare global {
  var DISABLE_EVENT_PROXY: boolean;
}
globalThis.DISABLE_EVENT_PROXY = false;

const EVENT_LOOP_UPDATE_INTERVAL = 25;
const METRICS_UPDATE_INTERVAL = 100;

export type Context = {
  chain: { id: number; name: string };
  client: ReadonlyClient;
  db: Db<Schema>;
  contracts: Record<
    string,
    {
      abi: Abi;
      address?: Address | readonly Address[];
      startBlock?: number;
      endBlock?: number;
    }
  >;
};

export type Indexing = {
  /** Run the setup functions. */
  processSetupEvents: Effect.Effect<void, Error>;
  /**
   * Run the indexing functions of a batch of backfill events, and resolve the
   * event properties that the indexing functions access.
   *
   * @dev Fails with {@link InvalidEventAccessError} when an indexing function
   * accesses an event property that the events don't include.
   */
  processHistoricalEvents: (params: {
    events: Event[];
    updateIndexingSeconds: (event: Event, chain: Chain) => void;
  }) => Effect.Effect<void, Error>;
  /** Run the indexing functions of the events of a live block. */
  processRealtimeEvents: (params: {
    events: Event[];
  }) => Effect.Effect<void, Error>;
};

export const getEventCount = (
  indexingFunctions: IndexingBuild["indexingFunctions"],
) => {
  const eventCount: { [eventName: string]: number } = {};
  for (const { name: eventName } of indexingFunctions) {
    eventCount[eventName] = 0;
  }
  return eventCount;
};

export type ColumnAccessProfile = {
  block: Set<keyof Block>;
  trace: Set<keyof Trace>;
  transaction: Set<keyof Transaction>;
  transactionReceipt: Set<keyof TransactionReceipt>;
  resolved: boolean;
  count: number;
};

export type ColumnAccessPattern = Map<string, ColumnAccessProfile>;

export const createColumnAccessPattern = ({
  indexingBuild,
}: {
  indexingBuild: Pick<IndexingBuild, "indexingFunctions">;
}): ColumnAccessPattern => {
  const columnAccessPattern = new Map<string, ColumnAccessProfile>();

  for (const { name: eventName } of indexingBuild.indexingFunctions) {
    columnAccessPattern.set(eventName, {
      block: new Set(),
      trace: new Set(),
      transaction: new Set(),
      transactionReceipt: new Set(),
      resolved: false,
      count: 0,
    });
  }

  return columnAccessPattern;
};

/**
 * Create the runner of indexing functions.
 *
 * @dev Indexing functions are promises. A batch is interrupted between events,
 * or while it awaits an indexing function.
 */
export const createIndexing = ({
  indexingBuild: {
    eventCallbacks,
    setupCallbacks,
    chains,
    contracts,
    indexingFunctions,
  },
  indexingStore,
  indexingCache,
  client,
  indexingErrorHandler,
  columnAccessPattern,
  eventCount,
}: {
  indexingBuild: Pick<
    IndexingBuild,
    | "eventCallbacks"
    | "setupCallbacks"
    | "chains"
    | "contracts"
    | "indexingFunctions"
  >;
  indexingStore: IndexingStore;
  indexingCache: IndexingCache;
  client: CachedViemClient;
  indexingErrorHandler: IndexingErrorHandler;
  columnAccessPattern: ColumnAccessPattern;
  eventCount: { [eventName: string]: number };
}): Effect.Effect<Indexing, never, Options | Metrics> =>
  Effect.gen(function* () {
    const options = yield* Options;
    const metrics = yield* Metrics;
    const clock = yield* Clock.Clock;

    const indexingFunctionArg = {
      event: undefined as Event | SetupEvent | undefined,
      context: {
        chain: { name: undefined!, id: undefined! },
        contracts: undefined!,
        client: undefined!,
        db: indexingStore.db,
      } as Context,
    };

    let lastChainId: number | undefined;
    const clientByChainId: { [chainId: number]: ReadonlyClient } = {};
    const contractsByChainId: {
      [chainId: number]: { [name: string]: Contract };
    } = {};

    for (const chain of chains) {
      clientByChainId[chain.id] = client.getClient(chain);
    }

    for (let i = 0; i < chains.length; i++) {
      const chain = chains[i]!;
      contractsByChainId[chain.id] = contracts[i]!;
    }

    const metricLabels: { [event: string]: { event: string } } = {};
    for (const { name } of indexingFunctions) {
      metricLabels[name] = { event: name };
    }

    const setChain = (chain: Chain) => {
      if (chain.id !== lastChainId) {
        indexingFunctionArg.context.chain.id = chain.id;
        indexingFunctionArg.context.chain.name = chain.name;
        indexingFunctionArg.context.contracts = contractsByChainId[chain.id]!;
        indexingFunctionArg.context.client = clientByChainId[chain.id]!;

        lastChainId = chain.id;
      }
    };

    /** Run an indexing function. */
    const runIndexingFunction = (
      fn: () => unknown,
    ): Effect.Effect<Result.Result<void, Error>> =>
      Effect.result(
        Effect.tryPromise({
          try: async () => {
            await fn();
          },
          catch: (error) =>
            error instanceof Error ? error : new Error(String(error)),
        }),
      );

    /**
     * Returns the error of an indexing function.
     *
     * Note: The retryable error of the indexing store takes precedence, to handle
     * user-code catching or augmenting errors from the indexing store.
     */
    const getError = (
      result: Result.Result<void, Error>,
    ): Error | undefined => {
      const retryableError = indexingErrorHandler.getRetryableError();
      if (retryableError !== undefined) {
        indexingErrorHandler.clearRetryableError();
        return retryableError;
      }
      return Result.isFailure(result) ? result.failure : undefined;
    };

    /** Log the error of an indexing function, and fail with it. */
    const failIndexingFunction = (
      error: Error,
      event: Event | SetupEvent,
      eventName: string,
    ): Effect.Effect<never, Error> =>
      Effect.gen(function* () {
        addStackTrace(error, options);
        addErrorMeta(error, toErrorMeta(event));

        const decodedCheckpoint = decodeCheckpoint(event.checkpoint);
        yield* Effect.logError({
          msg: "Error while processing event",
          event: eventName,
          chain: event.chain.name,
          chain_id: event.chain.id,
          block_number: decodedCheckpoint.blockNumber,
          error,
        });

        metrics.hasError = true;

        return yield* Effect.fail(
          error instanceof BaseError
            ? error
            : new IndexingFunctionError(error.message),
        );
      });

    const executeSetup = (event: SetupEvent): Effect.Effect<void, Error> =>
      Effect.gen(function* () {
        setChain(event.chain);

        const endClock = yield* startClockEffect;

        const result = yield* runIndexingFunction(() =>
          event.setupCallback.fn(indexingFunctionArg),
        );

        const error = getError(result);
        if (error !== undefined) {
          return yield* failIndexingFunction(
            error,
            event,
            event.setupCallback.name,
          );
        }

        metrics.ponder_indexing_function_duration.observe(
          metricLabels[event.setupCallback.name]!,
          yield* endClock,
        );
      });

    const executeEvent = (event: Event): Effect.Effect<void, Error> =>
      Effect.gen(function* () {
        setChain(event.chain);
        // @ts-expect-error
        indexingFunctionArg.event = event.event;

        const endClock = yield* startClockEffect;

        const result = yield* runIndexingFunction(() =>
          event.eventCallback.fn(indexingFunctionArg),
        );

        if (Result.isSuccess(result)) {
          metrics.ponder_indexing_function_duration.observe(
            metricLabels[event.eventCallback.name]!,
            yield* endClock,
          );
        }

        const error = getError(result);
        if (error === undefined) return;

        if (error instanceof InvalidEventAccessError) {
          return yield* Effect.fail(error);
        }

        return yield* failIndexingFunction(
          error,
          event,
          event.eventCallback.name,
        );
      });

    const resetFilterInclude = (eventName: string) => {
      const filters = perEventFilters.get(eventName)!;
      let include: Filter["include"];

      // Note: It's an invariant that all filters have the same type.
      switch (filters[0]!.type) {
        case "block": {
          include = defaultBlockFilterInclude;
          break;
        }
        case "transaction": {
          include = defaultTransactionFilterInclude;
          break;
        }
        case "trace": {
          include = defaultTraceFilterInclude.concat(
            filters[0]!.hasTransactionReceipt
              ? defaultTransactionReceiptInclude.map(
                  (value) => `transactionReceipt.${value}` as const,
                )
              : [],
          );
          break;
        }
        case "log": {
          include = defaultLogFilterInclude.concat(
            filters[0]!.hasTransactionReceipt
              ? defaultTransactionReceiptInclude.map(
                  (value) => `transactionReceipt.${value}` as const,
                )
              : [],
          );
          break;
        }
        case "transfer": {
          include = defaultTransferFilterInclude.concat(
            filters[0]!.hasTransactionReceipt
              ? defaultTransactionReceiptInclude.map(
                  (value) => `transactionReceipt.${value}` as const,
                )
              : [],
          );
          break;
        }
      }
      for (const filter of filters) {
        isFilterResolved.set(filter, false);
        filter.include = include;
      }
      columnAccessPattern.get(eventName)!.count = 0;
    };

    const blockProxy = createEventProxy<Block>(
      columnAccessPattern,
      "block",
      indexingErrorHandler,
      resetFilterInclude,
    );
    const transactionProxy = createEventProxy<Transaction>(
      columnAccessPattern,
      "transaction",
      indexingErrorHandler,
      resetFilterInclude,
    );
    const transactionReceiptProxy = createEventProxy<TransactionReceipt>(
      columnAccessPattern,
      "transactionReceipt",
      indexingErrorHandler,
      resetFilterInclude,
    );
    const traceProxy = createEventProxy<Trace>(
      columnAccessPattern,
      "trace",
      indexingErrorHandler,
      resetFilterInclude,
    );
    // Note: There is no `log` proxy because all log columns are required.

    // Note: Indexing functions map to one or more filters.
    const perEventFilters = new Map<string, Filter[]>();
    const isFilterResolved = new Map<Filter, boolean>();
    for (const eventCallback of eventCallbacks.flat()) {
      if (perEventFilters.has(eventCallback.name) === false) {
        perEventFilters.set(eventCallback.name, [eventCallback.filter]);
      } else {
        perEventFilters.get(eventCallback.name)!.push(eventCallback.filter);
      }

      isFilterResolved.set(eventCallback.filter, false);
    }

    const indexing: Indexing = {
      processSetupEvents: Effect.gen(function* () {
        for (const setupCallback of setupCallbacks.flat()) {
          const event = {
            type: "setup",
            chain: setupCallback.chain,
            setupCallback,
            checkpoint: encodeCheckpoint({
              ...ZERO_CHECKPOINT,
              chainId: BigInt(setupCallback.chain.id),
              blockNumber: BigInt(setupCallback.block ?? 0),
            }),
            block: BigInt(setupCallback.block ?? 0),
          } satisfies SetupEvent;

          client.event = event;

          yield* executeSetup(event);
        }
      }),
      processHistoricalEvents: ({ events, updateIndexingSeconds }) =>
        Effect.gen(function* () {
          let lastEventLoopUpdate = clock.currentTimeMillisUnsafe();
          let lastMetricsUpdate = lastEventLoopUpdate;

          for (let i = 0; i < events.length; i++) {
            const event = events[i]!;

            client.event = event;
            indexingCache.event = event;

            // Note: Create a new event object instead of mutuating the original one because
            // the event object could be reused across multiple indexing functions.
            const proxyEvent: typeof event.event = { ...event.event };

            switch (event.type) {
              case "block": {
                blockProxy.eventName = event.eventCallback.name;
                blockProxy.underlying = event.event.block as Block;
                proxyEvent.block = blockProxy.proxy;

                break;
              }
              case "transaction": {
                blockProxy.eventName = event.eventCallback.name;
                blockProxy.underlying = event.event.block as Block;
                proxyEvent.block = blockProxy.proxy;

                transactionProxy.eventName = event.eventCallback.name;
                transactionProxy.underlying = event.event
                  .transaction as Transaction;
                // @ts-expect-error
                proxyEvent.transaction = transactionProxy.proxy;

                if (event.event.transactionReceipt !== undefined) {
                  transactionReceiptProxy.eventName = event.eventCallback.name;
                  transactionReceiptProxy.underlying = event.event
                    .transactionReceipt as TransactionReceipt;
                  // @ts-expect-error
                  proxyEvent.transactionReceipt = transactionReceiptProxy.proxy;
                }

                break;
              }
              case "trace":
              case "transfer": {
                blockProxy.eventName = event.eventCallback.name;
                blockProxy.underlying = event.event.block as Block;
                proxyEvent.block = blockProxy.proxy;

                transactionProxy.eventName = event.eventCallback.name;
                transactionProxy.underlying = event.event
                  .transaction as Transaction;
                // @ts-expect-error
                proxyEvent.transaction = transactionProxy.proxy;

                if (event.event.transactionReceipt !== undefined) {
                  transactionReceiptProxy.eventName = event.eventCallback.name;
                  transactionReceiptProxy.underlying = event.event
                    .transactionReceipt as TransactionReceipt;
                  // @ts-expect-error
                  proxyEvent.transactionReceipt = transactionReceiptProxy.proxy;
                }

                traceProxy.eventName = event.eventCallback.name;
                traceProxy.underlying = event.event.trace as Trace;
                // @ts-expect-error
                proxyEvent.trace = traceProxy.proxy;

                break;
              }
              case "log": {
                blockProxy.eventName = event.eventCallback.name;
                blockProxy.underlying = event.event.block as Block;
                proxyEvent.block = blockProxy.proxy;

                if (event.event.transaction !== undefined) {
                  transactionProxy.eventName = event.eventCallback.name;
                  transactionProxy.underlying = event.event
                    .transaction as Transaction;
                  // @ts-expect-error
                  proxyEvent.transaction = transactionProxy.proxy;
                }

                if (event.event.transactionReceipt !== undefined) {
                  transactionReceiptProxy.eventName = event.eventCallback.name;
                  transactionReceiptProxy.underlying = event.event
                    .transactionReceipt as TransactionReceipt;
                  // @ts-expect-error
                  proxyEvent.transactionReceipt = transactionReceiptProxy.proxy;
                }

                break;
              }
            }

            // @ts-expect-error
            yield* executeEvent({ ...event, event: proxyEvent });

            metrics.incrementIndexingCompletedEvents(event.eventCallback.name);
            columnAccessPattern.get(event.eventCallback.name)!.count++;
            eventCount[event.eventCallback.name] =
              eventCount[event.eventCallback.name]! + 1;

            const now = clock.currentTimeMillisUnsafe();

            if (now - lastEventLoopUpdate > EVENT_LOOP_UPDATE_INTERVAL) {
              lastEventLoopUpdate = now;
              yield* Effect.yieldNow;
            }

            if (now - lastMetricsUpdate > METRICS_UPDATE_INTERVAL) {
              lastMetricsUpdate = now;
              updateIndexingSeconds(event, event.chain);
            }
          }

          let isEveryFilterResolvedBefore = true;
          let isEveryFilterResolvedAfter = true;

          for (const eventCallback of eventCallbacks.flat()) {
            if (isFilterResolved.get(eventCallback.filter)) continue;

            isEveryFilterResolvedBefore = false;

            if (columnAccessPattern.get(eventCallback.name)!.count < 100) {
              isEveryFilterResolvedAfter = false;
              continue;
            }
            isFilterResolved.set(eventCallback.filter, true);

            const filterInclude: Filter["include"] = [];

            const columnAccessProfile = columnAccessPattern.get(
              eventCallback.name,
            )!;
            columnAccessProfile.resolved = true;

            for (const column of columnAccessProfile.block) {
              filterInclude.push(`block.${column}` as const);
            }
            for (const column of columnAccessProfile.transaction) {
              // @ts-expect-error
              filterInclude.push(`transaction.${column}` as const);
            }
            for (const column of columnAccessProfile.transactionReceipt) {
              // @ts-expect-error
              filterInclude.push(`transactionReceipt.${column}` as const);
            }
            for (const column of columnAccessProfile.trace) {
              // @ts-expect-error
              filterInclude.push(`trace.${column}` as const);
            }

            switch (eventCallback.filter.type) {
              case "block": {
                filterInclude.push(...requiredBlockFilterInclude);
                break;
              }
              case "transaction": {
                // @ts-expect-error
                filterInclude.push(...requiredTransactionFilterInclude);
                break;
              }
              case "trace": {
                // @ts-expect-error
                filterInclude.push(...requiredTraceFilterInclude);
                if (eventCallback.filter.hasTransactionReceipt) {
                  filterInclude.push(
                    // @ts-expect-error
                    ...requiredTransactionReceiptInclude.map(
                      (value) => `transactionReceipt.${value}` as const,
                    ),
                  );
                }
                break;
              }
              case "log": {
                // @ts-expect-error
                filterInclude.push(...requiredLogFilterInclude);
                if (eventCallback.filter.hasTransactionReceipt) {
                  filterInclude.push(
                    // @ts-expect-error
                    ...requiredTransactionReceiptInclude.map(
                      (value) => `transactionReceipt.${value}` as const,
                    ),
                  );
                }
                break;
              }
              case "transfer": {
                // @ts-expect-error
                filterInclude.push(...requiredTransferFilterInclude);
                if (eventCallback.filter.hasTransactionReceipt) {
                  filterInclude.push(
                    // @ts-expect-error
                    ...requiredTransactionReceiptInclude.map(
                      (value) => `transactionReceipt.${value}` as const,
                    ),
                  );
                }
                break;
              }
            }

            // @ts-expect-error
            eventCallback.filter.include = dedupe(filterInclude);
          }

          if (
            isEveryFilterResolvedBefore === false &&
            isEveryFilterResolvedAfter
          ) {
            const blockInclude = new Set<keyof Block>();
            const transactionInclude = new Set<keyof Transaction>();
            const transactionReceiptInclude = new Set<
              keyof TransactionReceipt
            >();
            const traceInclude = new Set<keyof Trace>();

            for (const [_, columnAccessProfile] of columnAccessPattern) {
              for (const blockAccess of columnAccessProfile.block) {
                blockInclude.add(blockAccess);
              }
              for (const transactionAccess of columnAccessProfile.transaction) {
                transactionInclude.add(transactionAccess);
              }
              for (const transactionReceiptAccess of columnAccessProfile.transactionReceipt) {
                transactionReceiptInclude.add(transactionReceiptAccess);
              }
              for (const traceAccess of columnAccessProfile.trace) {
                traceInclude.add(traceAccess);
              }
            }

            yield* Effect.logDebug(
              {
                msg: "Resolved event property access",
                total_access_count:
                  blockInclude.size +
                  transactionInclude.size +
                  transactionReceiptInclude.size +
                  traceInclude.size,
                block_count: blockInclude.size,
                transaction_count: transactionInclude.size,
                transaction_receipt_count: transactionReceiptInclude.size,
                trace_count: traceInclude.size,
              },
              ["total_access_count"],
            );
          }

          yield* Effect.yieldNow;
          if (events.length > 0) {
            updateIndexingSeconds(
              events[events.length - 1]!,
              events[events.length - 1]!.chain,
            );
          }
        }),
      processRealtimeEvents: ({ events }) =>
        Effect.gen(function* () {
          for (let i = 0; i < events.length; i++) {
            const event = events[i]!;

            client.event = event;

            yield* executeEvent(event);

            metrics.incrementIndexingCompletedEvents(event.eventCallback.name);
            eventCount[event.eventCallback.name] =
              eventCount[event.eventCallback.name]! + 1;
          }
        }),
    };

    return indexing;
  });

export const createEventProxy = <
  T extends Block | Transaction | TransactionReceipt | Trace,
>(
  columnAccessPattern: ColumnAccessPattern,
  type: "block" | "trace" | "transaction" | "transactionReceipt",
  indexingErrorHandler: IndexingErrorHandler,
  resetFilterInclude: (eventName: string) => void,
): { proxy: T; underlying: T; eventName: string } => {
  let underlying: T = undefined!;
  let eventName: string = undefined!;

  // Note: We rely on the fact that `default[type]Include` is the entire set of possible columns.
  let defaultInclude: Set<keyof T>;
  if (type === "block") {
    // @ts-expect-error
    defaultInclude = new Set(defaultBlockInclude);
  } else if (type === "trace") {
    // @ts-expect-error
    defaultInclude = new Set(defaultTraceInclude);
  } else if (type === "transaction") {
    // @ts-expect-error
    defaultInclude = new Set(defaultTransactionInclude);
  } else if (type === "transactionReceipt") {
    // @ts-expect-error
    defaultInclude = new Set(defaultTransactionReceiptInclude);
  }

  const proxy = new Proxy<T>(
    // @ts-expect-error
    {
      [util.inspect.custom]: (): T => {
        const printableObject = {} as T;

        for (const prop of defaultInclude) {
          printableObject[prop] = proxy[prop];
        }

        return printableObject;
      },
    },
    {
      deleteProperty(_, prop) {
        if (
          // @ts-expect-error
          defaultInclude.has(prop) === false ||
          globalThis.DISABLE_EVENT_PROXY
        ) {
          return Reflect.deleteProperty(underlying, prop);
        }

        const profile = columnAccessPattern.get(eventName)!;
        const isInvalidAccess = prop in underlying === false;
        // @ts-expect-error
        profile[type].add(prop);

        if (isInvalidAccess) {
          profile.resolved = false;
          resetFilterInclude(eventName);
          // @ts-expect-error
          const error = new InvalidEventAccessError(`${type}.${prop}`);
          indexingErrorHandler.setRetryableError(error);
          throw error;
        }

        return Reflect.deleteProperty(underlying, prop);
      },
      has(_, prop) {
        // @ts-expect-error
        return defaultInclude.has(prop);
      },
      ownKeys() {
        return Array.from(defaultInclude);
      },
      set(_, prop, value) {
        if (
          // @ts-expect-error
          defaultInclude.has(prop) === false ||
          globalThis.DISABLE_EVENT_PROXY
        ) {
          return Reflect.set(underlying, prop, value);
        }

        const profile = columnAccessPattern.get(eventName)!;
        const isInvalidAccess = prop in underlying === false;
        // @ts-expect-error
        profile[type].add(prop);

        if (isInvalidAccess) {
          profile.resolved = false;
          resetFilterInclude(eventName);
          // @ts-expect-error
          const error = new InvalidEventAccessError(`${type}.${prop}`);
          indexingErrorHandler.setRetryableError(error);
          throw error;
        }

        return Reflect.set(underlying, prop, value);
      },
      get(_, prop, receiver) {
        if (
          // @ts-expect-error
          defaultInclude.has(prop) === false ||
          globalThis.DISABLE_EVENT_PROXY
        ) {
          return Reflect.get(underlying, prop, receiver);
        }

        const profile = columnAccessPattern.get(eventName)!;
        const isInvalidAccess = prop in underlying === false;
        // @ts-expect-error
        profile[type].add(prop);

        if (isInvalidAccess) {
          profile.resolved = false;
          resetFilterInclude(eventName);
          // @ts-expect-error
          const error = new InvalidEventAccessError(`${type}.${prop}`);
          indexingErrorHandler.setRetryableError(error);
          throw error;
        }

        return Reflect.get(underlying, prop, receiver);
      },
    },
  );

  return {
    proxy,
    set underlying(_underlying: T) {
      underlying = _underlying;
    },
    set eventName(_eventName: string) {
      eventName = _eventName;
    },
  };
};

export const toErrorMeta = (
  event: DeepPartial<Event> | DeepPartial<SetupEvent>,
) => {
  globalThis.DISABLE_EVENT_PROXY = true;
  switch (event?.type) {
    case "setup": {
      const meta = `Block:\n${prettyPrint({
        number: event?.block,
      })}`;
      globalThis.DISABLE_EVENT_PROXY = false;
      return meta;
    }

    case "log": {
      const meta = [
        `Event arguments:\n${prettyPrint(Array.isArray(event.event?.args) ? undefined : event.event?.args)}`,
        logText(event?.event?.log),
        transactionText(event?.event?.transaction),
        blockText(event?.event?.block),
      ].join("\n");
      globalThis.DISABLE_EVENT_PROXY = false;
      return meta;
    }

    case "trace": {
      const meta = [
        `Call trace arguments:\n${prettyPrint(Array.isArray(event.event?.args) ? undefined : event.event?.args)}`,
        traceText(event?.event?.trace),
        transactionText(event?.event?.transaction),
        blockText(event?.event?.block),
      ].join("\n");
      globalThis.DISABLE_EVENT_PROXY = false;
      return meta;
    }

    case "transfer": {
      const meta = [
        `Transfer arguments:\n${prettyPrint(event?.event?.transfer)}`,
        traceText(event?.event?.trace),
        transactionText(event?.event?.transaction),
        blockText(event?.event?.block),
      ].join("\n");
      globalThis.DISABLE_EVENT_PROXY = false;
      return meta;
    }

    case "block": {
      const meta = blockText(event?.event?.block);
      globalThis.DISABLE_EVENT_PROXY = false;
      return meta;
    }

    case "transaction": {
      const meta = [
        transactionText(event?.event?.transaction),
        blockText(event?.event?.block),
      ].join("\n");
      globalThis.DISABLE_EVENT_PROXY = false;
      return meta;
    }

    default: {
      return undefined;
    }
  }
};

export const addErrorMeta = (error: unknown, meta: string | undefined) => {
  // If error isn't an object we can modify, do nothing
  if (typeof error !== "object" || error === null) return;
  if (meta === undefined) return;

  try {
    const errorObj = error as { meta?: unknown };
    // If meta exists and is an array, try to add to it
    if (Array.isArray(errorObj.meta)) {
      errorObj.meta = [...errorObj.meta, meta];
    } else {
      // Otherwise set meta to be a new array with the meta string
      errorObj.meta = [meta];
    }
  } catch {
    // Ignore errors
  }
};

const blockText = (block?: DeepPartial<UserBlock>) =>
  `Block:\n${prettyPrint({
    hash: block?.hash,
    number: block?.number,
    timestamp: block?.timestamp,
  })}`;

const transactionText = (transaction?: DeepPartial<UserTransaction>) =>
  `Transaction:\n${prettyPrint({
    hash: transaction?.hash,
    from: transaction?.from,
    to: transaction?.to,
  })}`;

const logText = (log?: DeepPartial<UserLog>) =>
  `Log:\n${prettyPrint({
    index: log?.logIndex,
    address: log?.address,
  })}`;

const traceText = (trace?: DeepPartial<UserTrace>) =>
  `Trace:\n${prettyPrint({
    traceAddress:
      trace?.traceAddress === undefined
        ? undefined
        : JSON.stringify(trace.traceAddress),
    from: trace?.from,
    to: trace?.to,
  })}`;
