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
  InternalBlock,
  InternalTrace,
  InternalTransaction,
  InternalTransactionReceipt,
  Schema,
  SetupEvent,
  UserBlock,
  UserLog,
  UserTrace,
  UserTransaction,
} from "@/internal/types.js";
import {
  defaultBlockInclude,
  defaultInclude,
  defaultTraceInclude,
  defaultTransactionInclude,
  defaultTransactionReceiptInclude,
  isAddressFactory,
} from "@/runtime/filter.js";
import type { Db } from "@/types/db.js";
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
  blockInclude: (keyof InternalBlock)[];
  traceInclude: (keyof InternalTrace)[];
  transactionInclude: (keyof InternalTransaction)[];
  transactionReceiptInclude: (keyof InternalTransactionReceipt)[];
  accessed: Set<string>;
  resolved: boolean;
};

export type ColumnAccessPattern<
  T extends "global" | "perIndexingFunction" = "global" | "perIndexingFunction",
> = T extends "global"
  ? {
      type: "global";
      profile: ColumnAccessProfile;
      resolve: () => void;
    }
  : T extends "perIndexingFunction"
    ? {
        type: "perIndexingFunction";
        profile: {
          [eventName: string]: ColumnAccessProfile;
        };
        resolve: (eventName: string) => void;
      }
    :
        | ColumnAccessPattern<"global">
        | ColumnAccessPattern<"perIndexingFunction">;

export const createColumnAccessPattern = ({
  common,
  type,
}: {
  common: Common;
  type: "global" | "perIndexingFunction";
}): ColumnAccessPattern => {
  return type === "global"
    ? {
        type: "global",
        profile: {
          blockInclude: [...defaultBlockInclude],
          traceInclude: [...defaultTraceInclude],
          transactionInclude: [...defaultTransactionInclude],
          transactionReceiptInclude: [...defaultTransactionReceiptInclude],
          accessed: new Set(),
          resolved: false,
        },
        resolve: function () {
          const profile = this.profile;
          profile.resolved = true;
          profile.blockInclude = defaultBlockInclude.filter((column) =>
            profile.accessed.has(`block.${column}`),
          );
          profile.traceInclude = defaultTraceInclude.filter((column) =>
            profile.accessed.has(`trace.${column}`),
          );
          profile.transactionInclude = defaultTransactionInclude.filter(
            (column) => profile.accessed.has(`transaction.${column}`),
          );
          profile.transactionReceiptInclude =
            defaultTransactionReceiptInclude.filter((column) =>
              profile.accessed.has(`transactionReceipt.${column}`),
            );

          common.logger.info({
            service: "indexing",
            msg: `Column selection resolved: 
            ${profile.blockInclude.length}/${defaultBlockInclude.length} block columns, 
            ${profile.traceInclude.length}/${defaultTraceInclude.length} trace columns, 
            ${profile.transactionInclude.length}/${defaultTransactionInclude.length} transaction columns,
            ${profile.transactionReceiptInclude.length}/${defaultTransactionReceiptInclude.length} transactionReceipt columns.  
          `,
          });
        },
      }
    : {
        type: "perIndexingFunction",
        profile: {},
        resolve: function (eventName: string) {
          const profile = this.profile[eventName]!;
          profile.resolved = true;
          profile.blockInclude = defaultBlockInclude.filter((column) =>
            profile.accessed.has(`block.${column}`),
          );
          profile.traceInclude = defaultTraceInclude.filter((column) =>
            profile.accessed.has(`trace.${column}`),
          );
          profile.transactionInclude = defaultTransactionInclude.filter(
            (column) => profile.accessed.has(`transaction.${column}`),
          );
          profile.transactionReceiptInclude =
            defaultTransactionReceiptInclude.filter((column) =>
              profile.accessed.has(`transactionReceipt.${column}`),
            );

          common.logger.info({
            service: "indexing",
            msg: `Column selection resolved: 
            ${profile.blockInclude.length}/${defaultBlockInclude.length} block columns, 
            ${profile.traceInclude.length}/${defaultTraceInclude.length} trace columns, 
            ${profile.transactionInclude.length}/${defaultTransactionInclude.length} transaction columns,
            ${profile.transactionReceiptInclude.length}/${defaultTransactionReceiptInclude.length} transactionReceipt columns.  
          `,
          });
        },
      };
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

      const decodedCheckpoint = decodeCheckpoint(event.checkpoint);

      if (error instanceof InvalidEventAccessError) {
        throw error;
      }

      addStackTrace(error, common.options);
      addErrorMeta(error, toErrorMeta(event));

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

  const proxyController = createProxyController({
    pattern: columnAccessPattern,
  });

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

        try {
          await executeEvent(proxyController.toProxy({ event }));
        } finally {
          proxyController.reset();
        }

        common.logger.trace({
          service: "indexing",
          msg: `Completed indexing function (event="${event.name}", checkpoint=${event.checkpoint})`,
        });
      }

      switch (columnAccessPattern.type) {
        case "global": {
          if (
            columnAccessPattern.profile.resolved === false &&
            Object.values(eventCount).reduce((acc, cur) => acc + cur, 0) > 1_000
          ) {
            columnAccessPattern.resolve();
          }
          break;
        }
        case "perIndexingFunction": {
          for (const [eventName, profile] of Object.entries(
            columnAccessPattern.profile,
          )) {
            if (profile.resolved === false && eventCount[eventName]! > 1_000) {
              columnAccessPattern.resolve(eventName);
            }
          }
        }
      }

      updateCompletedEvents();
    },
  };
};

const createProxyController = ({
  pattern,
}: {
  pattern: ColumnAccessPattern;
}): {
  reset: () => void;
  toProxy: ({ event }: { event: Event }) => Event;
} => {
  const blockProxyHandler = createProxyHandler({ type: "block", pattern });
  const transactionProxyHandler = createProxyHandler({
    type: "transaction",
    pattern,
  });
  const transactionReceiptProxyHandler = createProxyHandler({
    type: "transactionReceipt",
    pattern,
  });
  const traceProxyHandler = createProxyHandler({ type: "trace", pattern });

  return {
    reset() {
      blockProxyHandler.reset();
      transactionProxyHandler.reset();
      transactionReceiptProxyHandler.reset();
      traceProxyHandler.reset();
    },
    toProxy({ event }) {
      switch (event.type) {
        case "block": {
          event.event = {
            ...event.event,
            block: new Proxy(
              event.event.block,
              blockProxyHandler.handler(event),
            ),
          };
          break;
        }
        case "transaction": {
          event.event = {
            ...event.event,
            block: new Proxy(
              event.event.block,
              blockProxyHandler.handler(event),
            ),
            transaction: new Proxy(
              event.event.transaction,
              transactionProxyHandler.handler(event),
            ),
            transactionReceipt:
              event.event.transactionReceipt === undefined
                ? undefined
                : new Proxy(
                    event.event.transactionReceipt,
                    transactionReceiptProxyHandler.handler(event),
                  ),
          };
          break;
        }
        case "log": {
          event.event = {
            ...event.event,
            block: new Proxy(
              event.event.block,
              blockProxyHandler.handler(event),
            ),
            transaction: new Proxy(
              event.event.transaction,
              transactionProxyHandler.handler(event),
            ),
            transactionReceipt:
              event.event.transactionReceipt === undefined
                ? undefined
                : new Proxy(
                    event.event.transactionReceipt,
                    transactionReceiptProxyHandler.handler(event),
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
              traceProxyHandler.handler(event),
            ),
            block: new Proxy(
              event.event.block,
              blockProxyHandler.handler(event),
            ),
            transaction: new Proxy(
              event.event.transaction,
              transactionProxyHandler.handler(event),
            ),
            transactionReceipt:
              event.event.transactionReceipt === undefined
                ? undefined
                : new Proxy(
                    event.event.transactionReceipt,
                    transactionReceiptProxyHandler.handler(event),
                  ),
          };
          break;
        }
      }

      return event;
    },
  };
};

const createProxyHandler = ({
  type,
  pattern,
}: {
  type: "block" | "trace" | "transaction" | "transactionReceipt";
  pattern: ColumnAccessPattern;
}): {
  reset: () => void;
  handler(event: Event): ProxyHandler<any>;
} => {
  let deletedProperties: string[] = [];
  let setProperties: string[] = [];
  let profile: ColumnAccessProfile | undefined = undefined;

  const handler: ProxyHandler<any> = {
    deleteProperty(target, prop) {
      if (typeof prop === "string") {
        if (deletedProperties.includes(prop)) {
          return true;
        }

        deletedProperties.push(prop);
      }

      return Reflect.deleteProperty(target, prop);
    },
    has(target, prop) {
      if (typeof prop === "string") {
        const key = `${type}.${prop}`;
        // @ts-ignore
        if (defaultInclude.has(key)) {
          return true;
        }
      }

      return Reflect.has(target, prop);
    },
    ownKeys(target) {
      switch (type) {
        case "block": {
          return dedupe([...Reflect.ownKeys(target), ...defaultBlockInclude]);
        }
        case "transaction": {
          return dedupe([
            ...Reflect.ownKeys(target),
            ...defaultTransactionInclude,
          ]);
        }
        case "transactionReceipt": {
          return dedupe([
            ...Reflect.ownKeys(target),
            ...defaultTransactionReceiptInclude,
          ]);
        }
        case "trace": {
          return dedupe([...Reflect.ownKeys(target), ...defaultTraceInclude]);
        }
      }
    },
    set(target, prop, newValue, receiver) {
      if (typeof prop === "string") {
        if (setProperties.includes(prop) === false) {
          setProperties.push(prop);
        }
      }

      return Reflect.set(target, prop, newValue, receiver);
    },
    get(obj, prop, receiver) {
      if (typeof prop === "string" && profile !== undefined) {
        const key = `${type}.${prop}`;
        profile.accessed.add(key);

        if (
          profile.resolved &&
          setProperties.includes(key) === false &&
          prop in obj === false &&
          // @ts-ignore
          defaultInclude.has(key)
        ) {
          profile.resolved = false;
          throw new InvalidEventAccessError(key);
        }
      }
      return Reflect.get(obj, prop, receiver);
    },
  };

  return {
    reset() {
      deletedProperties = [];
      setProperties = [];
    },
    handler(event) {
      if (pattern.type === "global") {
        profile = pattern.profile;
      } else {
        if (pattern.profile[event.name] === undefined) {
          pattern.profile[event.name] = {
            blockInclude: [...defaultBlockInclude],
            traceInclude: [...defaultTraceInclude],
            transactionInclude: [...defaultTransactionInclude],
            transactionReceiptInclude: [...defaultTransactionReceiptInclude],
            accessed: new Set(),
            resolved: false,
          };
        }
        profile = pattern.profile[event.name]!;
      }

      return handler;
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
