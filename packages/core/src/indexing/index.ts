import util from "node:util";
import type { IndexingCache } from "@/indexing-store/cache.js";
import type { IndexingStore } from "@/indexing-store/index.js";
import type { CachedViemClient } from "@/indexing/client.js";
import type { Common } from "@/internal/common.js";
import {
  BaseError,
  IndexingFunctionError,
  InvalidEventAccessError,
  ShutdownError,
} from "@/internal/errors.js";
import type {
  Chain,
  ContractSource,
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
  isAddressFactory,
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
  ZERO_CHECKPOINT,
  decodeCheckpoint,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import { dedupe } from "@/utils/dedupe.js";
import { prettyPrint } from "@/utils/print.js";
import { startClock } from "@/utils/timer.js";
import type { Abi, Address } from "viem";
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
  processSetupEvents: (params: {
    db: IndexingStore;
  }) => Promise<void>;
  processHistoricalEvents: (params: {
    events: Event[];
    db: IndexingStore;
    cache: IndexingCache;
    updateIndexingSeconds: (event: Event, chain: Chain) => void;
  }) => Promise<void>;
  processRealtimeEvents: (params: {
    events: Event[];
    db: IndexingStore;
  }) => Promise<void>;
};

export const getEventCount = (
  indexingFunctions: IndexingBuild["indexingFunctions"],
) => {
  const eventCount: { [eventName: string]: number } = {};
  for (const eventName of Object.keys(indexingFunctions)) {
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

  for (const eventName of Object.keys(indexingBuild.indexingFunctions)) {
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

export const createIndexing = ({
  common,
  indexingBuild: { sources, chains, indexingFunctions },
  client,
  eventCount,
  indexingErrorHandler,
  columnAccessPattern,
}: {
  common: Common;
  indexingBuild: Pick<
    IndexingBuild,
    "sources" | "chains" | "indexingFunctions"
  >;
  client: CachedViemClient;
  eventCount: { [eventName: string]: number };
  indexingErrorHandler: IndexingErrorHandler;
  columnAccessPattern: ColumnAccessPattern;
}): Indexing => {
  const context: Context = {
    chain: { name: undefined!, id: undefined! },
    contracts: undefined!,
    client: undefined!,
    db: undefined!,
  };

  const chainById: { [chainId: number]: Chain } = {};
  const clientByChainId: { [chainId: number]: ReadonlyClient } = {};
  const contractsByChainId: {
    [chainId: number]: Record<
      string,
      {
        abi: Abi;
        address?: Address | readonly Address[];
        startBlock?: number;
        endBlock?: number;
      }
    >;
  } = {};

  // build chainById
  for (const chain of chains) {
    chainById[chain.id] = chain;
  }

  // build clientByChainId
  for (const chain of chains) {
    clientByChainId[chain.id] = client.getClient(chain);
  }

  // build contractsByChainId
  for (const source of sources) {
    if (source.type === "block" || source.type === "account") continue;

    let address: Address | undefined;

    if (source.filter.type === "log") {
      const _address = source.filter.address;
      if (
        isAddressFactory(_address) === false &&
        Array.isArray(_address) === false &&
        _address !== undefined
      ) {
        address = _address as Address;
      }
    } else {
      const _address = source.filter.toAddress;
      if (isAddressFactory(_address) === false && _address !== undefined) {
        address = (_address as Address[])[0];
      }
    }

    if (contractsByChainId[source.filter.chainId] === undefined) {
      contractsByChainId[source.filter.chainId] = {};
    }

    // Note: multiple sources with the same contract (logs and traces)
    // should only create one entry in the `contracts` object
    if (contractsByChainId[source.filter.chainId]![source.name] !== undefined)
      continue;

    contractsByChainId[source.filter.chainId]![source.name] = {
      abi: source.abi,
      address,
      startBlock: source.filter.fromBlock,
      endBlock: source.filter.toBlock,
    };
  }

  const updateCompletedEvents = () => {
    for (const event of Object.keys(eventCount)) {
      const metricLabel = { event };
      common.metrics.ponder_indexing_completed_events.set(
        metricLabel,
        eventCount[event]!,
      );
    }
  };

  const executeSetup = async ({
    event,
  }: { event: SetupEvent }): Promise<void> => {
    const indexingFunction = indexingFunctions[event.name];
    const metricLabel = { event: event.name };

    try {
      context.chain.id = event.chainId;
      context.chain.name = chainById[event.chainId]!.name;
      context.contracts = contractsByChainId[event.chainId]!;

      const endClock = startClock();

      await indexingFunction!({ context });

      // Note: Check `getRetryableError` to handle user-code catching errors
      // from the indexing store.

      if (indexingErrorHandler.getRetryableError()) {
        const retryableError = indexingErrorHandler.getRetryableError()!;
        indexingErrorHandler.clearRetryableError();
        throw retryableError;
      }

      common.metrics.ponder_indexing_function_duration.observe(
        metricLabel,
        endClock(),
      );
    } catch (_error) {
      let error = _error instanceof Error ? _error : new Error(String(_error));

      // Note: Use `getRetryableError` rather than `error` to avoid
      // issues with the user-code augmenting errors from the indexing store.

      if (indexingErrorHandler.getRetryableError()) {
        const retryableError = indexingErrorHandler.getRetryableError()!;
        indexingErrorHandler.clearRetryableError();
        error = retryableError;
      }

      if (common.shutdown.isKilled) {
        throw new ShutdownError();
      }

      addStackTrace(error, common.options);
      addErrorMeta(error, toErrorMeta(event));

      const decodedCheckpoint = decodeCheckpoint(event.checkpoint);
      common.logger.error({
        msg: "Error while processing event",
        event: event.name,
        chain: chainById[event.chainId]!.name,
        chain_id: event.chainId,
        block_number: decodedCheckpoint.blockNumber,
        error,
      });

      common.metrics.hasError = true;

      if (error instanceof BaseError === false) {
        error = new IndexingFunctionError(error.message);
      }

      throw error;
    }
  };

  // metric label for "ponder_indexing_function_duration"
  const executeEvent = async (event: Event): Promise<void> => {
    const indexingFunction = indexingFunctions[event.name];
    const metricLabel: { event: string } = { event: event.name };

    try {
      context.chain.id = event.chainId;
      context.chain.name = chainById[event.chainId]!.name;
      context.contracts = contractsByChainId[event.chainId]!;

      const endClock = startClock();

      await indexingFunction!({ event: event.event, context });

      common.metrics.ponder_indexing_function_duration.observe(
        metricLabel,
        endClock(),
      );

      // Note: Check `getRetryableError` to handle user-code catching errors
      // from the indexing store.

      if (indexingErrorHandler.getRetryableError()) {
        const retryableError = indexingErrorHandler.getRetryableError()!;
        indexingErrorHandler.clearRetryableError();
        throw retryableError;
      }
    } catch (_error) {
      let error = _error instanceof Error ? _error : new Error(String(_error));

      // Note: Use `getRetryableError` rather than `error` to avoid
      // issues with the user-code augmenting errors from the indexing store.

      if (indexingErrorHandler.getRetryableError()) {
        const retryableError = indexingErrorHandler.getRetryableError()!;
        indexingErrorHandler.clearRetryableError();
        error = retryableError;
      }

      if (common.shutdown.isKilled) {
        throw new ShutdownError();
      }

      if (error instanceof InvalidEventAccessError) {
        throw error;
      }

      addStackTrace(error, common.options);
      addErrorMeta(error, toErrorMeta(event));

      const decodedCheckpoint = decodeCheckpoint(event.checkpoint);

      common.logger.error({
        msg: "Error while processing event",
        event: event.name,
        chain: chainById[event.chainId]!.name,
        chain_id: event.chainId,
        block_number: decodedCheckpoint.blockNumber,
        error,
      });

      common.metrics.hasError = true;

      if (error instanceof BaseError === false) {
        error = new IndexingFunctionError(error.message);
      }

      throw error;
    }
  };

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

  // Note: Filters and indexing functions have a many-to-many relationship.
  const perFilterEventNames = new Map<Filter, string[]>();
  const perEventFilters = new Map<string, Filter[]>();
  const isFilterResolved = new Map<Filter, boolean>();
  for (const eventName of Object.keys(indexingFunctions)) {
    let sourceName: string;
    if (eventName.includes(":")) {
      [sourceName] = eventName.split(":") as [string];
    } else {
      [sourceName] = eventName.split(".") as [string];
    }

    const _sources = sources.filter((s) => s.name === sourceName);
    for (const source of _sources) {
      if (perFilterEventNames.has(source.filter) === false) {
        perFilterEventNames.set(source.filter, []);
      }
      perFilterEventNames.get(source.filter)!.push(eventName);
    }
    perEventFilters.set(
      eventName,
      _sources.map((s) => s.filter),
    );
  }

  for (const source of sources) {
    isFilterResolved.set(source.filter, false);
  }

  return {
    async processSetupEvents({ db }) {
      context.db = db;
      for (const eventName of Object.keys(indexingFunctions)) {
        if (!eventName.endsWith(":setup")) continue;

        const [contractName] = eventName.split(":");

        for (const chain of chains) {
          const source = sources.find(
            (s) =>
              s.type === "contract" &&
              s.name === contractName &&
              s.filter.chainId === chain.id,
          ) as ContractSource | undefined;

          if (source === undefined) continue;

          const event = {
            type: "setup",
            chainId: chain.id,
            checkpoint: encodeCheckpoint({
              ...ZERO_CHECKPOINT,
              chainId: BigInt(chain.id),
              blockNumber: BigInt(source.filter.fromBlock ?? 0),
            }),

            name: eventName,

            block: BigInt(source.filter.fromBlock ?? 0),
          } satisfies SetupEvent;

          client.event = event;
          context.client = clientByChainId[chain.id]!;

          eventCount[eventName]!++;

          await executeSetup({ event });
        }
      }
    },
    async processHistoricalEvents({
      events,
      db,
      cache,
      updateIndexingSeconds,
    }) {
      let lastEventLoopUpdate = performance.now();
      let lastMetricsUpdate = performance.now();

      context.db = db;
      for (let i = 0; i < events.length; i++) {
        const event = events[i]!;

        client.event = event;
        context.client = clientByChainId[event.chainId]!;
        cache.event = event;

        // Note: Create a new event object instead of mutuating the original one because
        // the event object could be reused across multiple indexing functions.
        const proxyEvent: typeof event.event = { ...event.event };

        switch (event.type) {
          case "block": {
            blockProxy.eventName = event.name;
            blockProxy.underlying = event.event.block as Block;
            proxyEvent.block = blockProxy.proxy;

            break;
          }
          case "transaction": {
            blockProxy.eventName = event.name;
            blockProxy.underlying = event.event.block as Block;
            proxyEvent.block = blockProxy.proxy;

            transactionProxy.eventName = event.name;
            transactionProxy.underlying = event.event
              .transaction as Transaction;
            // @ts-expect-error
            proxyEvent.transaction = transactionProxy.proxy;

            if (event.event.transactionReceipt !== undefined) {
              transactionReceiptProxy.eventName = event.name;
              transactionReceiptProxy.underlying = event.event
                .transactionReceipt as TransactionReceipt;
              // @ts-expect-error
              proxyEvent.transactionReceipt = transactionReceiptProxy.proxy;
            }

            break;
          }
          case "trace":
          case "transfer": {
            blockProxy.eventName = event.name;
            blockProxy.underlying = event.event.block as Block;
            proxyEvent.block = blockProxy.proxy;

            transactionProxy.eventName = event.name;
            transactionProxy.underlying = event.event
              .transaction as Transaction;
            // @ts-expect-error
            proxyEvent.transaction = transactionProxy.proxy;

            if (event.event.transactionReceipt !== undefined) {
              transactionReceiptProxy.eventName = event.name;
              transactionReceiptProxy.underlying = event.event
                .transactionReceipt as TransactionReceipt;
              // @ts-expect-error
              proxyEvent.transactionReceipt = transactionReceiptProxy.proxy;
            }

            traceProxy.eventName = event.name;
            traceProxy.underlying = event.event.trace as Trace;
            // @ts-expect-error
            proxyEvent.trace = traceProxy.proxy;

            break;
          }
          case "log": {
            blockProxy.eventName = event.name;
            blockProxy.underlying = event.event.block as Block;
            proxyEvent.block = blockProxy.proxy;

            if (event.event.transaction !== undefined) {
              transactionProxy.eventName = event.name;
              transactionProxy.underlying = event.event
                .transaction as Transaction;
              // @ts-expect-error
              proxyEvent.transaction = transactionProxy.proxy;
            }

            if (event.event.transactionReceipt !== undefined) {
              transactionReceiptProxy.eventName = event.name;
              transactionReceiptProxy.underlying = event.event
                .transactionReceipt as TransactionReceipt;
              // @ts-expect-error
              proxyEvent.transactionReceipt = transactionReceiptProxy.proxy;
            }

            break;
          }
        }

        // @ts-expect-error
        await executeEvent({ ...event, event: proxyEvent });

        eventCount[event.name]!++;
        columnAccessPattern.get(event.name)!.count++;

        const now = performance.now();

        if (now - lastEventLoopUpdate > EVENT_LOOP_UPDATE_INTERVAL) {
          lastEventLoopUpdate = now;
          await new Promise(setImmediate);
        }

        if (now - lastMetricsUpdate > METRICS_UPDATE_INTERVAL) {
          lastMetricsUpdate = now;
          updateCompletedEvents();
          updateIndexingSeconds(event, chainById[event.chainId]!);
        }
      }

      let isEveryFilterResolvedBefore = true;
      let isEveryFilterResolvedAfter = true;

      for (const source of sources) {
        const eventNames = perFilterEventNames.get(source.filter)!;

        if (isFilterResolved.get(source.filter)) continue;

        isEveryFilterResolvedBefore = false;

        if (
          eventNames.some(
            (eventName) => columnAccessPattern.get(eventName)!.count < 100,
          )
        ) {
          isEveryFilterResolvedAfter = false;
          continue;
        }
        isFilterResolved.set(source.filter, true);

        const filterInclude: Filter["include"] = [];

        for (const eventName of eventNames) {
          const columnAccessProfile = columnAccessPattern.get(eventName)!;
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
        }

        switch (source.filter.type) {
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
            if (source.filter.hasTransactionReceipt) {
              // @ts-expect-error
              filterInclude.push(...requiredTransactionReceiptInclude);
            }
            break;
          }
          case "log": {
            // @ts-expect-error
            filterInclude.push(...requiredLogFilterInclude);
            if (source.filter.hasTransactionReceipt) {
              // @ts-expect-error
              filterInclude.push(...requiredTransactionReceiptInclude);
            }
            break;
          }
          case "transfer": {
            // @ts-expect-error
            filterInclude.push(...requiredTransferFilterInclude);
            if (source.filter.hasTransactionReceipt) {
              // @ts-expect-error
              filterInclude.push(...requiredTransactionReceiptInclude);
            }
            break;
          }
        }

        // @ts-expect-error
        source.filter.include = dedupe(filterInclude);
      }

      if (isEveryFilterResolvedBefore === false && isEveryFilterResolvedAfter) {
        const blockInclude = new Set<keyof Block>();
        const transactionInclude = new Set<keyof Transaction>();
        const transactionReceiptInclude = new Set<keyof TransactionReceipt>();
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

        common.logger.debug(
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

      await new Promise(setImmediate);
      updateCompletedEvents();
      if (events.length > 0) {
        updateIndexingSeconds(
          events[events.length - 1]!,
          chainById[events[events.length - 1]!.chainId]!,
        );
      }
    },
    async processRealtimeEvents({ events, db }) {
      context.db = db;
      for (let i = 0; i < events.length; i++) {
        const event = events[i]!;

        client.event = event;
        context.client = clientByChainId[event.chainId]!;

        eventCount[event.name]!++;

        await executeEvent(event);
      }

      updateCompletedEvents();
    },
  };
};

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
    traceIndex: trace?.traceIndex,
    from: trace?.from,
    to: trace?.to,
  })}`;
