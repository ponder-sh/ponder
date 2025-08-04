import type { IndexingCache } from "@/indexing-store/cache.js";
import type { IndexingStore } from "@/indexing-store/index.js";
import type { CachedViemClient } from "@/indexing/client.js";
import {
  BaseError,
  IndexingFunctionError,
  ShutdownError,
} from "@/internal/errors.js";
import type {
  Chain,
  Event,
  IndexingErrorHandler,
  PonderApp,
  Schema,
  SetupEvent,
  TraceFilter,
} from "@/internal/types.js";
import { isAddressFactory } from "@/runtime/filter.js";
import { getPerChainPonderApp } from "@/runtime/index.js";
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

export const createIndexing = (
  app: PonderApp,
  {
    client,
    eventCount,
    indexingErrorHandler,
  }: {
    client: CachedViemClient;
    eventCount: { [eventName: string]: number };
    indexingErrorHandler: IndexingErrorHandler;
  },
): Indexing => {
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
  for (const { chain } of app.indexingBuild) {
    chainById[chain.id] = chain;
  }

  // build clientByChainId
  for (const _app of getPerChainPonderApp(app)) {
    clientByChainId[_app.indexingBuild.chain.id] = client.getClient(_app);
  }

  // build contractsByChainId
  for (const indexingBuild of app.indexingBuild) {
    contractsByChainId[indexingBuild.chain.id] = {};

    for (const eventCallback of indexingBuild.eventCallbacks) {
      // TODO(kyle) what if only setup events
      if (eventCallback.type !== "contract") continue;

      let address: Address | undefined;

      if (eventCallback.filter.type === "log") {
        const _address = eventCallback.filter.address;
        if (
          isAddressFactory(_address) === false &&
          Array.isArray(_address) === false &&
          _address !== undefined
        ) {
          address = _address as Address;
        }
      } else {
        const _address = (eventCallback.filter as TraceFilter).toAddress;
        if (isAddressFactory(_address) === false && _address !== undefined) {
          address = (_address as Address[])[0];
        }
      }

      // Note: multiple sources with the same contract (logs and traces)
      // should only create one entry in the `contracts` object
      if (
        contractsByChainId[indexingBuild.chain.id]![eventCallback.name] !==
        undefined
      ) {
        continue;
      }

      contractsByChainId[indexingBuild.chain.id]![eventCallback.name] = {
        abi: eventCallback.metadata.abi,
        address,
        startBlock: eventCallback.filter.fromBlock,
        endBlock: eventCallback.filter.toBlock,
      };
    }
  }

  const updateCompletedEvents = () => {
    for (const event of Object.keys(eventCount)) {
      const metricLabel = {
        event,
      };
      app.common.metrics.ponder_indexing_completed_events.set(
        metricLabel,
        eventCount[event]!,
      );
    }
  };

  const executeSetup = async ({
    event,
  }: { event: SetupEvent }): Promise<void> => {
    const metricLabel = { event: event.eventCallback.name };

    try {
      context.chain.id = event.chain.id;
      context.chain.name = event.chain.name;
      context.contracts = contractsByChainId[event.chain.id]!;

      const endClock = startClock();

      await event.eventCallback.callback({ context });

      app.common.metrics.ponder_indexing_function_duration.observe(
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

      if (app.common.shutdown.isKilled) {
        throw new ShutdownError();
      }

      addStackTrace(error, app.common.options);
      addErrorMeta(error, toErrorMeta(event));

      const decodedCheckpoint = decodeCheckpoint(event.checkpoint);
      app.common.logger.error({
        service: "indexing",
        msg: `Error while processing '${event.eventCallback.name}' event in '${event.chain.name}' block ${decodedCheckpoint.blockNumber}`,
        error,
      });

      app.common.metrics.ponder_indexing_has_error.set(1);

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
    const metricLabel = { event: event.eventCallback.name };

    try {
      context.chain.id = event.chain.id;
      context.chain.name = event.chain.name;
      context.contracts = contractsByChainId[event.chain.id]!;

      const endClock = startClock();

      await event.eventCallback.callback({ event: event.event, context });

      app.common.metrics.ponder_indexing_function_duration.observe(
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

      if (app.common.shutdown.isKilled) {
        throw new ShutdownError();
      }

      addStackTrace(error, app.common.options);
      addErrorMeta(error, toErrorMeta(event));

      const decodedCheckpoint = decodeCheckpoint(event.checkpoint);

      app.common.logger.error({
        service: "indexing",
        msg: `Error while processing '${event.eventCallback.name}' event in '${event.chain.name}' block ${decodedCheckpoint.blockNumber}`,
        error,
      });

      app.common.metrics.ponder_indexing_has_error.set(1);

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
      for (const indexingBuild of app.indexingBuild) {
        for (const eventCallback of indexingBuild.eventCallbacks) {
          if (eventCallback.type !== "setup") continue;

          eventCount[eventCallback.name]!++;

          const event = {
            type: "setup",
            chain: indexingBuild.chain,
            eventCallback,
            checkpoint: encodeCheckpoint({
              ...ZERO_CHECKPOINT,
              chainId: BigInt(indexingBuild.chain.id),
              blockNumber: BigInt(eventCallback.filter.fromBlock ?? 0),
            }),

            block: BigInt(eventCallback.filter.fromBlock ?? 0),
          } satisfies SetupEvent;

          await executeSetup({ event });
        }
      }
    },
    async processEvents({ events, db, cache }) {
      context.db = db;
      for (let i = 0; i < events.length; i++) {
        const event = events[i]!;

        client.event = event;
        context.client = clientByChainId[event.chain.id]!;

        if (cache) {
          cache.event = event;
        }

        eventCount[event.eventCallback.name]!++;

        app.common.logger.trace({
          service: "indexing",
          msg: `Started indexing function (event="${event.eventCallback.name}", checkpoint=${event.checkpoint})`,
        });

        await executeEvent({ event });

        app.common.logger.trace({
          service: "indexing",
          msg: `Completed indexing function (event="${event.eventCallback.name}", checkpoint=${event.checkpoint})`,
        });
      }

      updateCompletedEvents();
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
