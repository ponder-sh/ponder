import type { IndexingStore } from "@/indexing-store/index.js";
import type { Common } from "@/internal/common.js";
import type {
  Chain,
  ContractSource,
  Event,
  IndexingBuild,
  IndexingFunctions,
  Schema,
  SetupEvent,
  Source,
} from "@/internal/types.js";
import { isAddressFactory } from "@/sync/filter.js";
import type { Sync } from "@/sync/index.js";
import type { Db } from "@/types/db.js";
import type { Block, Log, Trace, Transaction } from "@/types/eth.js";
import type { DeepPartial } from "@/types/utils.js";
import {
  type Checkpoint,
  decodeCheckpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { prettyPrint } from "@/utils/print.js";
import { startClock } from "@/utils/timer.js";
import type { Abi, Address, Chain as ViemChain } from "viem";
import { checksumAddress, createClient } from "viem";
import { addStackTrace } from "./addStackTrace.js";
import { type ReadOnlyClient, getPonderActions } from "./ponderActions.js";

export type Context = {
  chain: ViemChain;
  client: ReadOnlyClient;
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

export type Service = {
  // static
  common: Common;
  indexingFunctions: IndexingFunctions;

  // state
  isKilled: boolean;

  eventCount: {
    [eventName: string]: number;
  };
  startCheckpoint: Checkpoint;

  /**
   * Reduce memory usage by reserving space for objects ahead of time
   * instead of creating a new one for each event.
   */
  currentEvent: {
    contextState: {
      blockNumber: bigint;
    };
    context: Context;
  };

  // static cache
  chainById: { [chainId: number]: Chain };
  clientByChainId: { [chainId: number]: Context["client"] };
  contractsByChainId: { [chainId: number]: Context["contracts"] };
};

export const create = ({
  common,
  indexingBuild: { sources, chains, indexingFunctions },
  sync,
}: {
  common: Common;
  indexingBuild: Pick<
    IndexingBuild,
    "sources" | "chains" | "indexingFunctions"
  >;
  sync: Sync;
}): Service => {
  const contextState: Service["currentEvent"]["contextState"] = {
    blockNumber: undefined!,
  };
  const clientByChainId: Service["clientByChainId"] = {};
  const contractsByChainId: Service["contractsByChainId"] = {};

  const chainById = chains.reduce<Service["chainById"]>((acc, cur) => {
    acc[cur.chain.id] = cur;
    return acc;
  }, {});

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

  // build clientByChainId
  for (const chain of chains) {
    const transport = sync.getCachedTransport(chain);
    clientByChainId[chain.chain.id] = createClient({
      transport,
      chain: chain.chain,
      // @ts-ignore
    }).extend(getPonderActions(contextState));
  }

  // build eventCount
  const eventCount: Service["eventCount"] = {};
  for (const eventName of Object.keys(indexingFunctions)) {
    eventCount[eventName] = 0;
  }

  return {
    common,
    indexingFunctions,
    isKilled: false,
    eventCount,
    startCheckpoint: decodeCheckpoint(sync.getStartCheckpoint()),
    currentEvent: {
      contextState,
      context: {
        chain: undefined!,
        contracts: undefined!,
        client: undefined!,
        db: undefined!,
      },
    },
    chainById,
    clientByChainId,
    contractsByChainId,
  };
};

export const processSetupEvents = async (
  indexingService: Service,
  {
    sources,
    chains,
  }: {
    sources: Source[];
    chains: Chain[];
  },
): Promise<
  | { status: "error"; error: Error }
  | { status: "success" }
  | { status: "killed" }
> => {
  for (const eventName of Object.keys(indexingService.indexingFunctions)) {
    if (!eventName.endsWith(":setup")) continue;

    const [contractName] = eventName.split(":");

    for (const chain of chains) {
      const source = sources.find(
        (s) =>
          s.type === "contract" &&
          s.name === contractName &&
          s.filter.chainId === chain.chain.id,
      ) as ContractSource | undefined;

      if (source === undefined) continue;

      if (indexingService.isKilled) return { status: "killed" };

      indexingService.eventCount[eventName]!++;

      const result = await executeSetup(indexingService, {
        event: {
          type: "setup",
          chainId: chain.chain.id,
          checkpoint: encodeCheckpoint({
            ...zeroCheckpoint,
            chainId: BigInt(chain.chain.id),
            blockNumber: BigInt(source.filter.fromBlock ?? 0),
          }),

          name: eventName,

          block: BigInt(source.filter.fromBlock ?? 0),
        },
      });

      if (result.status !== "success") {
        return result;
      }
    }
  }

  return { status: "success" };
};

export const processEvents = async (
  indexingService: Service,
  { events }: { events: Event[] },
): Promise<
  | { status: "error"; error: Error }
  | { status: "success" }
  | { status: "killed" }
> => {
  for (let i = 0; i < events.length; i++) {
    if (indexingService.isKilled) return { status: "killed" };

    const event = events[i]!;

    indexingService.eventCount[event.name]!++;

    indexingService.common.logger.trace({
      service: "indexing",
      msg: `Started indexing function (event="${event.name}", checkpoint=${event.checkpoint})`,
    });

    const result = await executeEvent(indexingService, { event });
    if (result.status !== "success") {
      return result;
    }

    indexingService.common.logger.trace({
      service: "indexing",
      msg: `Completed indexing function (event="${event.name}", checkpoint=${event.checkpoint})`,
    });

    // periodically update metrics
    if (i % 93 === 0) {
      updateCompletedEvents(indexingService);

      const eventTimestamp = decodeCheckpoint(event.checkpoint).blockTimestamp;

      indexingService.common.metrics.ponder_indexing_completed_seconds.set(
        eventTimestamp - indexingService.startCheckpoint.blockTimestamp,
      );
      indexingService.common.metrics.ponder_indexing_completed_timestamp.set(
        eventTimestamp,
      );

      // Note: allows for terminal and logs to be updated
      await new Promise(setImmediate);
    }
  }

  // set completed seconds
  if (events.length > 0) {
    const lastEventInBatchTimestamp = decodeCheckpoint(
      events[events.length - 1]!.checkpoint,
    ).blockTimestamp;

    indexingService.common.metrics.ponder_indexing_completed_seconds.set(
      lastEventInBatchTimestamp -
        indexingService.startCheckpoint.blockTimestamp,
    );
    indexingService.common.metrics.ponder_indexing_completed_timestamp.set(
      lastEventInBatchTimestamp,
    );
  }
  // set completed events
  updateCompletedEvents(indexingService);

  return { status: "success" };
};

export const setIndexingStore = (
  indexingService: Service,
  indexingStore: IndexingStore<"historical" | "realtime">,
) => {
  indexingService.currentEvent.context.db = {
    find: indexingStore.find,
    insert: indexingStore.insert,
    update: indexingStore.update,
    delete: indexingStore.delete,
    sql: indexingStore.sql,
  };
};

export const kill = (indexingService: Service) => {
  indexingService.common.logger.debug({
    service: "indexing",
    msg: "Killed indexing service",
  });
  indexingService.isKilled = true;
};

export const updateTotalSeconds = (
  indexingService: Service,
  endCheckpoint: Checkpoint,
) => {
  indexingService.common.metrics.ponder_indexing_total_seconds.set(
    endCheckpoint.blockTimestamp -
      indexingService.startCheckpoint.blockTimestamp,
  );
};

const updateCompletedEvents = (indexingService: Service) => {
  for (const event of Object.keys(indexingService.eventCount)) {
    const metricLabel = {
      event,
    };
    indexingService.common.metrics.ponder_indexing_completed_events.set(
      metricLabel,
      indexingService.eventCount[event]!,
    );
  }
};

const executeSetup = async (
  indexingService: Service,
  { event }: { event: SetupEvent },
): Promise<
  | { status: "error"; error: Error }
  | { status: "success" }
  | { status: "killed" }
> => {
  const {
    common,
    indexingFunctions,
    currentEvent,
    chainById,
    contractsByChainId,
    clientByChainId,
  } = indexingService;
  const indexingFunction = indexingFunctions[event.name];
  const metricLabel = { event: event.name };

  try {
    // set currentEvent
    currentEvent.context.chain = chainById[event.chainId]!.chain;
    currentEvent.context.client = clientByChainId[event.chainId]!;
    currentEvent.context.contracts = contractsByChainId[event.chainId]!;
    currentEvent.contextState.blockNumber = event.block;

    const endClock = startClock();

    await indexingFunction!({
      context: currentEvent.context,
    });

    common.metrics.ponder_indexing_function_duration.observe(
      metricLabel,
      endClock(),
    );
  } catch (_error) {
    if (indexingService.isKilled) return { status: "killed" };
    const error = _error instanceof Error ? _error : new Error(String(_error));

    addStackTrace(error, common.options);
    addErrorMeta(error, toErrorMeta(event));

    const decodedCheckpoint = decodeCheckpoint(event.checkpoint);
    common.logger.error({
      service: "indexing",
      msg: `Error while processing '${event.name}' event in '${chainById[event.chainId]!.chain.name}' block ${decodedCheckpoint.blockNumber}`,
      error,
    });

    common.metrics.ponder_indexing_has_error.set(1);

    return { status: "error", error: error };
  }

  return { status: "success" };
};

const executeEvent = async (
  indexingService: Service,
  { event }: { event: Event },
): Promise<
  | { status: "error"; error: Error }
  | { status: "success" }
  | { status: "killed" }
> => {
  const {
    common,
    indexingFunctions,
    currentEvent,
    chainById,
    contractsByChainId,
    clientByChainId,
  } = indexingService;
  const indexingFunction = indexingFunctions[event.name];
  const metricLabel = { event: event.name };

  try {
    // set currentEvent
    currentEvent.context.chain = chainById[event.chainId]!.chain;
    currentEvent.context.client = clientByChainId[event.chainId]!;
    currentEvent.context.contracts = contractsByChainId[event.chainId]!;
    currentEvent.contextState.blockNumber = event.event.block.number;

    const endClock = startClock();

    await indexingFunction!({
      event: event.event,
      context: currentEvent.context,
    });

    common.metrics.ponder_indexing_function_duration.observe(
      metricLabel,
      endClock(),
    );
  } catch (_error) {
    if (indexingService.isKilled) return { status: "killed" };
    const error = _error instanceof Error ? _error : new Error(String(_error));

    addStackTrace(error, common.options);
    addErrorMeta(error, toErrorMeta(event));

    const decodedCheckpoint = decodeCheckpoint(event.checkpoint);

    common.logger.error({
      service: "indexing",
      msg: `Error while processing '${event.name}' event in '${chainById[event.chainId]!.chain.name}' block ${decodedCheckpoint.blockNumber}`,
      error,
    });

    common.metrics.ponder_indexing_has_error.set(1);

    return { status: "error", error };
  }

  return { status: "success" };
};

const toErrorMeta = (event: DeepPartial<Event> | DeepPartial<SetupEvent>) => {
  switch (event?.type) {
    case "setup": {
      return `Block:\n${prettyPrint({
        number: event?.block,
      })}`;
    }

    case "log": {
      return [
        `Event arguments:\n${prettyPrint(event?.event?.args)}`,
        logText(event?.event?.log),
        transactionText(event?.event?.transaction),
        blockText(event?.event?.block),
      ].join("\n");
    }

    case "trace": {
      return [
        `Call trace arguments:\n${prettyPrint(event?.event?.args)}`,
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

const addErrorMeta = (error: unknown, meta: string | undefined) => {
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
