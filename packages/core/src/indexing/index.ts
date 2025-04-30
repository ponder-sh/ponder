import type { IndexingCache } from "@/indexing-store/cache.js";
import type { IndexingStore } from "@/indexing-store/index.js";
import type { CachedViemClient } from "@/indexing/client.js";
import { ShutdownError } from "@/internal/errors.js";
import type {
  Chain,
  Event,
  PonderApp,
  Schema,
  SetupEvent,
  TraceFilter,
} from "@/internal/types.js";
import { isAddressFactory } from "@/sync/filter.js";
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
import { checksumAddress } from "viem";
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
  }) => Promise<{ status: "error"; error: Error } | { status: "success" }>;
  processEvents: (params: {
    events: Event[];
    db: IndexingStore;
    cache?: IndexingCache;
  }) => Promise<{ status: "error"; error: Error } | { status: "success" }>;
};

export const createIndexing = (
  app: PonderApp,
  {
    client,
    eventCount,
  }: {
    client: CachedViemClient;
    eventCount: { [eventName: string]: number };
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
  for (const chain of app.indexingBuild.chains) {
    chainById[chain.chain.id] = chain;
  }

  // build clientByChainId
  for (const chain of app.indexingBuild.chains) {
    clientByChainId[chain.chain.id] = client.getClient(chain);
  }

  // build contractsByChainId
  for (const indexingBuild of app.indexingBuild) {
    contractsByChainId[indexingBuild.chain.chain.id] = {};

    for (const eventCallback of indexingBuild.eventCallbacks) {
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
        contractsByChainId[indexingBuild.chain.chain.id]![
          eventCallback.name
        ] !== undefined
      )
        continue;

      contractsByChainId[indexingBuild.chain.chain.id]![eventCallback.name] = {
        abi: eventCallback.metadata.abi,
        address: address ? checksumAddress(address) : address,
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
  }: { event: SetupEvent }): Promise<
    { status: "error"; error: Error } | { status: "success" }
  > => {
    const metricLabel = { event: event.eventCallback.name };

    try {
      context.chain.id = event.chain.chain.id;
      context.chain.name = chainById[event.chain.chain.id]!.chain.name;
      context.contracts = contractsByChainId[event.chain.chain.id]!;

      const endClock = startClock();

      await event.eventCallback.callback({ context });

      app.common.metrics.ponder_indexing_function_duration.observe(
        metricLabel,
        endClock(),
      );
    } catch (_error) {
      const error =
        _error instanceof Error ? _error : new Error(String(_error));

      if (app.common.shutdown.isKilled) {
        throw new ShutdownError();
      }

      addStackTrace(error, app.common.options);
      addErrorMeta(error, toErrorMeta(event));

      const decodedCheckpoint = decodeCheckpoint(event.checkpoint);
      app.common.logger.error({
        service: "indexing",
        msg: `Error while processing '${event.eventCallback.name}' event in '${chainById[event.chain.chain.id]!.chain.name}' block ${decodedCheckpoint.blockNumber}`,
        error,
      });

      app.common.metrics.ponder_indexing_has_error.set(1);

      return { status: "error", error: error };
    }

    return { status: "success" };
  };

  const executeEvent = async ({
    event,
  }: { event: Event }): Promise<
    { status: "error"; error: Error } | { status: "success" }
  > => {
    const metricLabel = { event: event.eventCallback.name };

    try {
      context.chain.id = event.chain.chain.id;
      context.chain.name = chainById[event.chain.chain.id]!.chain.name;
      context.contracts = contractsByChainId[event.chain.chain.id]!;

      const endClock = startClock();

      await event.eventCallback.callback({ event: event.event, context });

      app.common.metrics.ponder_indexing_function_duration.observe(
        metricLabel,
        endClock(),
      );
    } catch (_error) {
      const error =
        _error instanceof Error ? _error : new Error(String(_error));

      if (app.common.shutdown.isKilled) {
        throw new ShutdownError();
      }

      addStackTrace(error, app.common.options);
      addErrorMeta(error, toErrorMeta(event));

      const decodedCheckpoint = decodeCheckpoint(event.checkpoint);

      app.common.logger.error({
        service: "indexing",
        msg: `Error while processing '${event.eventCallback.name}' event in '${chainById[event.chain.chain.id]!.chain.name}' block ${decodedCheckpoint.blockNumber}`,
        error,
      });

      app.common.metrics.ponder_indexing_has_error.set(1);

      return { status: "error", error };
    }

    return { status: "success" };
  };

  return {
    async processSetupEvents({ db }) {
      context.db = db;
      for (const indexingBuild of app.indexingBuild) {
        for (const eventCallback of indexingBuild.eventCallbacks) {
          if (eventCallback.type !== "setup") continue;

          eventCount[eventCallback.name]!++;

          const block = eventCallback.filter.fromBlock ?? 0;

          const result = await executeSetup({
            event: {
              type: "setup",
              checkpoint: encodeCheckpoint({
                ...ZERO_CHECKPOINT,
                chainId: BigInt(indexingBuild.chain.chain.id),
                blockNumber: BigInt(block),
              }),
              chain: indexingBuild.chain,
              eventCallback,

              block: BigInt(block),
            },
          });

          if (result.status !== "success") {
            return result;
          }
        }
      }

      return { status: "success" };
    },
    async processEvents({ events, db, cache }) {
      context.db = db;
      for (let i = 0; i < events.length; i++) {
        const event = events[i]!;

        client.event = event;
        context.client = clientByChainId[event.chain.chain.id]!;

        if (cache) {
          cache.event = event;
        }

        eventCount[event.eventCallback.name]!++;

        app.common.logger.trace({
          service: "indexing",
          msg: `Started indexing function (event="${event.eventCallback.name}", checkpoint=${event.checkpoint})`,
        });

        const result = await executeEvent({ event });
        if (result.status !== "success") {
          return result;
        }

        app.common.logger.trace({
          service: "indexing",
          msg: `Completed indexing function (event="${event.eventCallback.name}", checkpoint=${event.checkpoint})`,
        });
      }

      // set completed events
      updateCompletedEvents();

      return { status: "success" };
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
