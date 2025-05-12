import type { IndexingCache } from "@/indexing-store/cache.js";
import type { IndexingStore } from "@/indexing-store/index.js";
import type { CachedViemClient } from "@/indexing/client.js";
import type { Common } from "@/internal/common.js";
import { ShutdownError } from "@/internal/errors.js";
import type {
  Chain,
  ContractSource,
  Event,
  IndexingBuild,
  Schema,
  SetupEvent,
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

export const createIndexing = ({
  common,
  indexingBuild: { sources, chains, indexingFunctions },
  client,
  eventCount,
}: {
  common: Common;
  indexingBuild: Pick<
    IndexingBuild,
    "sources" | "chains" | "indexingFunctions"
  >;
  client: CachedViemClient;
  eventCount: { [eventName: string]: number };
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
      address: address ? checksumAddress(address) : address,
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
  }: { event: SetupEvent }): Promise<
    { status: "error"; error: Error } | { status: "success" }
  > => {
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
      const error =
        _error instanceof Error ? _error : new Error(String(_error));

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

      return { status: "error", error: error };
    }

    return { status: "success" };
  };

  const executeEvent = async ({
    event,
  }: { event: Event }): Promise<
    { status: "error"; error: Error } | { status: "success" }
  > => {
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
      const error =
        _error instanceof Error ? _error : new Error(String(_error));

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

      return { status: "error", error };
    }

    return { status: "success" };
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

          const result = await executeSetup({ event });

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
        context.client = clientByChainId[event.chainId]!;

        if (cache) {
          cache.event = event;
        }

        eventCount[event.name]!++;

        common.logger.trace({
          service: "indexing",
          msg: `Started indexing function (event="${event.name}", checkpoint=${event.checkpoint})`,
        });

        const result = await executeEvent({ event });
        if (result.status !== "success") {
          return result;
        }

        common.logger.trace({
          service: "indexing",
          msg: `Completed indexing function (event="${event.name}", checkpoint=${event.checkpoint})`,
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
