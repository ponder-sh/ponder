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
  defaultBlockInclude,
  defaultLogInclude,
  defaultTraceInclude,
  defaultTransactionInclude,
  defaultTransactionReceiptInclude,
  isAddressFactory,
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
  processEvents: (params: {
    events: Event[];
    db: IndexingStore;
    cache?: IndexingCache;
  }) => Promise<void>;
};

export type ColumnAccessProfile = {
  block: Set<keyof Block>;
  trace: Set<keyof Trace>;
  transaction: Set<keyof Transaction>;
  transactionReceipt: Set<keyof TransactionReceipt>;
  resolved: boolean;
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
      const metricLabel = {
        event,
      };
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
        throw retryableError;
      }

      if (common.shutdown.isKilled) {
        throw new ShutdownError();
      }

      addStackTrace(error, common.options);
      addErrorMeta(error, toErrorMeta(event));

      const decodedCheckpoint = decodeCheckpoint(event.checkpoint);
      common.logger.error({
        service: "indexing",
        msg: `Error while processing '${event.name}' event in '${chainById[event.chainId]!.name}' block ${decodedCheckpoint.blockNumber}`,
        error,
      });

      common.metrics.ponder_indexing_has_error.set(1);

      if (error instanceof BaseError === false) {
        error = new IndexingFunctionError(error.message);
      }

      throw error;
    }

    // Note: Check `getRetryableError` to handle user-code catching errors
    // from the indexing store.

    if (indexingErrorHandler.getRetryableError()) {
      const retryableError = indexingErrorHandler.getRetryableError()!;
      indexingErrorHandler.clearRetryableError();
      throw retryableError;
    }
  };

  // metric label for "ponder_indexing_function_duration"
  const metricLabel: { event: string } = { event: "" };
  const executeEvent = async (event: Event): Promise<void> => {
    const indexingFunction = indexingFunctions[event.name];
    metricLabel.event = event.name;

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
    } catch (_error) {
      let error = _error instanceof Error ? _error : new Error(String(_error));

      // Note: Use `getRetryableError` rather than `error` to avoid
      // issues with the user-code augmenting errors from the indexing store.

      if (indexingErrorHandler.getRetryableError()) {
        const retryableError = indexingErrorHandler.getRetryableError()!;
        indexingErrorHandler.clearRetryableError();
        throw retryableError;
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
        service: "indexing",
        msg: `Error while processing '${event.name}' event in '${chainById[event.chainId]!.name}' block ${decodedCheckpoint.blockNumber}`,
        error,
      });

      common.metrics.ponder_indexing_has_error.set(1);

      if (error instanceof BaseError === false) {
        error = new IndexingFunctionError(error.message);
      }

      throw error;
    }

    // Note: Check `getRetryableError` to handle user-code catching errors
    // from the indexing store.

    if (indexingErrorHandler.getRetryableError()) {
      const retryableError = indexingErrorHandler.getRetryableError()!;
      indexingErrorHandler.clearRetryableError();
      throw retryableError;
    }
  };

  const blockProxy = createEventProxy<Block>(columnAccessPattern, "block");
  const transactionProxy = createEventProxy<Transaction>(
    columnAccessPattern,
    "transaction",
  );
  const transactionReceiptProxy = createEventProxy<TransactionReceipt>(
    columnAccessPattern,
    "transactionReceipt",
  );
  const traceProxy = createEventProxy<Trace>(columnAccessPattern, "trace");
  // Note: There is no `log` proxy because all log columns are required.

  const perFilterEventNames = new Map<Filter, string[]>();
  for (const eventName of Object.keys(indexingFunctions)) {
    let sourceName: string;
    if (eventName.includes(":")) {
      [sourceName] = eventName.split(":") as [string];
    } else {
      [sourceName] = eventName.split(".") as [string];
    }

    const source = sources.find((s) => s.name === sourceName)!;

    if (perFilterEventNames.has(source.filter) === false) {
      perFilterEventNames.set(source.filter, []);
    }
    perFilterEventNames.get(source.filter)!.push(eventName);
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
    async processEvents({ events, db, cache }) {
      context.db = db;
      for (let i = 0; i < events.length; i++) {
        const event = events[i]!;

        client.event = event;
        context.client = clientByChainId[event.chainId]!;

        if (cache) {
          cache.event = event;
        }

        eventCount[event.name]!++;

        common.logger.trace({
          service: "indexing",
          msg: `Started indexing function (event="${event.name}", checkpoint=${event.checkpoint})`,
        });

        // TODO(kyle) don't mutate the event object

        switch (event.type) {
          case "block": {
            blockProxy.eventName = event.name;
            blockProxy.underlying = event.event.block as Block;
            event.event.block = blockProxy.proxy;

            break;
          }
          case "transaction": {
            blockProxy.eventName = event.name;
            blockProxy.underlying = event.event.block as Block;
            event.event.block = blockProxy.proxy;

            transactionProxy.eventName = event.name;
            transactionProxy.underlying = event.event
              .transaction as Transaction;
            event.event.transaction = transactionProxy.proxy;

            if (event.event.transactionReceipt !== undefined) {
              transactionReceiptProxy.eventName = event.name;
              transactionReceiptProxy.underlying = event.event
                .transactionReceipt as TransactionReceipt;
              event.event.transactionReceipt = transactionReceiptProxy.proxy;
            }

            break;
          }
          case "trace":
          case "transfer": {
            blockProxy.eventName = event.name;
            blockProxy.underlying = event.event.block as Block;
            event.event.block = blockProxy.proxy;

            transactionProxy.eventName = event.name;
            transactionProxy.underlying = event.event
              .transaction as Transaction;
            event.event.transaction = transactionProxy.proxy;

            if (event.event.transactionReceipt !== undefined) {
              transactionReceiptProxy.eventName = event.name;
              transactionReceiptProxy.underlying = event.event
                .transactionReceipt as TransactionReceipt;
              event.event.transactionReceipt = transactionReceiptProxy.proxy;
            }

            traceProxy.eventName = event.name;
            traceProxy.underlying = event.event.trace as Trace;
            event.event.trace = traceProxy.proxy;

            break;
          }
          case "log": {
            blockProxy.eventName = event.name;
            blockProxy.underlying = event.event.block as Block;
            event.event.block = blockProxy.proxy;

            transactionProxy.eventName = event.name;
            transactionProxy.underlying = event.event
              .transaction as Transaction;
            event.event.transaction = transactionProxy.proxy;

            if (event.event.transactionReceipt !== undefined) {
              transactionReceiptProxy.eventName = event.name;
              transactionReceiptProxy.underlying = event.event
                .transactionReceipt as TransactionReceipt;
              event.event.transactionReceipt = transactionReceiptProxy.proxy;
            }

            break;
          }
        }

        await executeEvent(event);

        common.logger.trace({
          service: "indexing",
          msg: `Completed indexing function (event="${event.name}", checkpoint=${event.checkpoint})`,
        });
      }

      let isEveryFilterResolvedBefore = true;
      let isEveryFilterResolvedAfter = true;

      for (const source of sources) {
        const eventNames = perFilterEventNames.get(source.filter)!;

        if (
          eventNames.every(
            (eventName) => columnAccessPattern.get(eventName)!.resolved,
          )
        ) {
          continue;
        }
        isEveryFilterResolvedBefore = false;

        if (eventNames.some((eventName) => eventCount[eventName]! < 100)) {
          isEveryFilterResolvedAfter = false;
          continue;
        }

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

        common.logger.info({
          service: "indexing",
          msg: `Resolved column selection:
  ${blockInclude.size}/${defaultBlockInclude.length} block columns
  ${transactionInclude.size}/${defaultTransactionInclude.length} transaction columns
  ${transactionReceiptInclude.size}/${defaultTransactionReceiptInclude.length} transaction receipt columns
  ${traceInclude.size}/${defaultTraceInclude.length} trace columns
  ${defaultLogInclude.length}/${defaultLogInclude.length} log columns`,
        });
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

  // TODO(kyle) `resolved` = true doesn't necessarily mean column selection has been applied to the event.

  const proxy = new Proxy<T>(
    // @ts-expect-error
    {},
    {
      deleteProperty(_, prop) {
        // @ts-expect-error
        if (defaultInclude.has(prop) === false) {
          return Reflect.deleteProperty(underlying, prop);
        }

        const profile = columnAccessPattern.get(eventName)!;
        const isInvalidAccess =
          // @ts-expect-error
          profile.resolved === true && profile[type].has(prop) === false;
        // @ts-expect-error
        columnAccessPattern.get(eventName)![type].add(prop);

        if (isInvalidAccess) {
          // @ts-expect-error
          throw new InvalidEventAccessError(`${type}.${prop}`);
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
        // @ts-expect-error
        if (defaultInclude.has(prop) === false) {
          return Reflect.set(underlying, prop, value);
        }

        const profile = columnAccessPattern.get(eventName)!;
        const isInvalidAccess =
          // @ts-expect-error
          profile.resolved === true && profile[type].has(prop) === false;
        // @ts-expect-error
        columnAccessPattern.get(eventName)![type].add(prop);

        if (isInvalidAccess) {
          // @ts-expect-error
          throw new InvalidEventAccessError(`${type}.${prop}`);
        }

        return Reflect.set(underlying, prop, value);
      },
      get(_, prop, receiver) {
        // @ts-expect-error
        if (defaultInclude.has(prop) === false) {
          return Reflect.get(underlying, prop, receiver);
        }

        const profile = columnAccessPattern.get(eventName)!;
        const isInvalidAccess =
          // @ts-expect-error
          profile.resolved === true && profile[type].has(prop) === false;
        // @ts-expect-error
        columnAccessPattern.get(eventName)![type].add(prop);

        if (isInvalidAccess) {
          // @ts-expect-error
          throw new InvalidEventAccessError(`${type}.${prop}`);
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
  switch (event?.type) {
    case "setup": {
      return `Block:\n${prettyPrint({
        number: event?.block,
      })}`;
    }

    case "log": {
      return [
        `Event arguments:\n${prettyPrint(Array.isArray(event.event?.args) ? undefined : event.event?.args)}`,
        logText(event?.event?.log),
        transactionText(event?.event?.transaction),
        blockText(event?.event?.block),
      ].join("\n");
    }

    case "trace": {
      return [
        `Call trace arguments:\n${prettyPrint(Array.isArray(event.event?.args) ? undefined : event.event?.args)}`,
        traceText(event?.event?.trace),
        transactionText(event?.event?.transaction),
        blockText(event?.event?.block),
      ].join("\n");
    }

    case "transfer": {
      return [
        `Transfer arguments:\n${prettyPrint(event?.event?.transfer)}`,
        traceText(event?.event?.trace),
        transactionText(event?.event?.transaction),
        blockText(event?.event?.block),
      ].join("\n");
    }

    case "block": {
      return blockText(event?.event?.block);
    }

    case "transaction": {
      return [
        transactionText(event?.event?.transaction),
        blockText(event?.event?.block),
      ].join("\n");
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
