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
  IndexingBuild,
  IndexingErrorHandler,
  Schema,
  SetupEvent,
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
import type { Block, Log, Trace, Transaction } from "@/types/eth.js";
import type { DeepPartial } from "@/types/utils.js";
import {
  ZERO_CHECKPOINT,
  decodeCheckpoint,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
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
  blockInclude: typeof defaultBlockInclude;
  traceInclude: typeof defaultTraceInclude;
  transactionInclude: typeof defaultTransactionInclude;
  transactionReceiptInclude: typeof defaultTransactionReceiptInclude;
  defaultInclude: Set<string>;
  accessed: Set<string>;
  eventCount: number;
  resolved: boolean;
  resolve: () => void;
};

export const createColumnAccessProfile = (): ColumnAccessProfile => ({
  blockInclude: [...defaultBlockInclude],
  traceInclude: [...defaultTraceInclude],
  transactionInclude: [...defaultTransactionInclude],
  transactionReceiptInclude: [...defaultTransactionReceiptInclude],
  accessed: new Set(),
  eventCount: 0,
  resolved: false,
  defaultInclude: new Set([
    ...defaultLogInclude,
    ...defaultBlockInclude,
    ...defaultTraceInclude,
    ...defaultTransactionInclude,
    ...defaultTransactionReceiptInclude,
  ]),
  resolve: function () {
    this.resolved = true;
    this.blockInclude = this.blockInclude.filter((key) =>
      this.accessed.has(key),
    );
    this.traceInclude = this.traceInclude.filter((key) =>
      this.accessed.has(key),
    );
    this.transactionInclude = this.transactionInclude.filter((key) =>
      this.accessed.has(key),
    );
    this.transactionReceiptInclude = this.transactionReceiptInclude.filter(
      (key) => this.accessed.has(key),
    );
  },
});

export const createIndexing = ({
  common,
  indexingBuild: { sources, chains, indexingFunctions },
  client,
  eventCount,
  indexingErrorHandler,
  columnAccessProfile,
}: {
  common: Common;
  indexingBuild: Pick<
    IndexingBuild,
    "sources" | "chains" | "indexingFunctions"
  >;
  client: CachedViemClient;
  eventCount: { [eventName: string]: number };
  indexingErrorHandler: IndexingErrorHandler;
  columnAccessProfile: ColumnAccessProfile;
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

  const executeEvent = async ({ event }: { event: Event }): Promise<void> => {
    const indexingFunction = indexingFunctions[event.name];
    const metricLabel = { event: event.name };

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

        await executeEvent({
          event: toProxy({ event, profile: columnAccessProfile }),
        });

        common.logger.trace({
          service: "indexing",
          msg: `Completed indexing function (event="${event.name}", checkpoint=${event.checkpoint})`,
        });
      }

      if (
        columnAccessProfile.resolved === false &&
        columnAccessProfile.eventCount > 1000
      ) {
        columnAccessProfile.resolve();
      }

      // set completed events
      updateCompletedEvents();
    },
  };
};

const proxyHandler = ({
  type,
  profile,
}: {
  type: "log" | "block" | "trace" | "transaction" | "transactionReceipt";
  profile: ColumnAccessProfile;
}): ProxyHandler<any> => {
  return {
    get(obj, prop, receiver) {
      if (typeof prop === "string") {
        const key = `${type}.${prop}`;
        profile.accessed.add(key);

        if (
          profile.resolved &&
          prop in obj === false &&
          profile.defaultInclude.has(key)
        ) {
          profile.resolved = false;
          throw new InvalidEventAccessError(key);
        }
      }
      return Reflect.get(obj, prop, receiver);
    },
  };
};

export const toProxy = ({
  event,
  profile,
}: { event: Event; profile: ColumnAccessProfile }): Event => {
  profile.eventCount++;
  switch (event.type) {
    case "block": {
      event.event = {
        ...event.event,
        block: new Proxy(
          event.event.block,
          proxyHandler({ type: "block", profile }),
        ),
      };
      break;
    }
    case "transaction": {
      event.event = {
        ...event.event,
        block: new Proxy(
          event.event.block,
          proxyHandler({ type: "block", profile }),
        ),
        transaction: new Proxy(
          event.event.transaction,
          proxyHandler({ type: "transaction", profile }),
        ),
        transactionReceipt:
          event.event.transactionReceipt === undefined
            ? undefined
            : new Proxy(
                event.event.transactionReceipt,
                proxyHandler({ type: "transactionReceipt", profile }),
              ),
      };
      break;
    }
    case "log": {
      event.event = {
        ...event.event,
        log: new Proxy(event.event.log, proxyHandler({ type: "log", profile })),
        block: new Proxy(
          event.event.block,
          proxyHandler({ type: "block", profile }),
        ),
        transaction: new Proxy(
          event.event.transaction,
          proxyHandler({ type: "transaction", profile }),
        ),
        transactionReceipt:
          event.event.transactionReceipt === undefined
            ? undefined
            : new Proxy(
                event.event.transactionReceipt,
                proxyHandler({ type: "transactionReceipt", profile }),
              ),
      };
      break;
    }
    case "transfer":
    case "trace": {
      event.event = {
        ...event.event,
        trace: new Proxy(
          event.event.trace,
          proxyHandler({ type: "trace", profile }),
        ),
        block: new Proxy(
          event.event.block,
          proxyHandler({ type: "block", profile }),
        ),
        transaction: new Proxy(
          event.event.transaction,
          proxyHandler({ type: "transaction", profile }),
        ),
        transactionReceipt:
          event.event.transactionReceipt === undefined
            ? undefined
            : new Proxy(
                event.event.transactionReceipt,
                proxyHandler({ type: "transactionReceipt", profile }),
              ),
      };
      break;
    }
  }

  return event;
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

const blockText = (block?: DeepPartial<Block>) =>
  `Block:\n${prettyPrint({
    hash: block?.hash,
    number: block?.number,
    timestamp: block?.timestamp,
  })}`;

const transactionText = (transaction?: DeepPartial<Transaction>) =>
  `Transaction:\n${prettyPrint({
    hash: transaction?.hash,
    from: transaction?.from,
    to: transaction?.to,
  })}`;

const logText = (log?: DeepPartial<Log>) =>
  `Log:\n${prettyPrint({
    index: log?.logIndex,
    address: log?.address,
  })}`;

const traceText = (trace?: DeepPartial<Trace>) =>
  `Trace:\n${prettyPrint({
    traceIndex: trace?.traceIndex,
    from: trace?.from,
    to: trace?.to,
  })}`;
