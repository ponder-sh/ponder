import type { IndexingFunctions } from "@/build/configAndIndexingFunctions.js";
import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import type { Schema } from "@/drizzle/index.js";
import type { IndexingStore } from "@/indexing-store/index.js";
import type { Sync } from "@/sync/index.js";
import {
  type ContractSource,
  type Source,
  isAddressFactory,
} from "@/sync/source.js";
import type { Db } from "@/types/db.js";
import {
  type Checkpoint,
  decodeCheckpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { never } from "@/utils/never.js";
import { prettyPrint } from "@/utils/print.js";
import { startClock } from "@/utils/timer.js";
import type { Abi, Address } from "viem";
import { checksumAddress, createClient } from "viem";
import type {
  BlockEvent,
  CallTraceEvent,
  Event,
  LogEvent,
  SetupEvent,
} from "../sync/events.js";
import { addStackTrace } from "./addStackTrace.js";
import { type ReadOnlyClient, buildCachedActions } from "./ponderActions.js";

export type Context = {
  network: { chainId: number; name: string };
  client: ReadOnlyClient;
  db: Db<Schema>;
  contracts: Record<
    string,
    {
      abi: Abi;
      address?: Address | readonly Address[];
      startBlock: number;
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
  networkByChainId: { [chainId: number]: Network };
  clientByChainId: { [chainId: number]: Context["client"] };
  contractsByChainId: { [chainId: number]: Context["contracts"] };
};

export const create = ({
  indexingFunctions,
  common,
  sources,
  networks,
  sync,
}: {
  indexingFunctions: IndexingFunctions;
  common: Common;
  sources: Source[];
  networks: Network[];
  sync: Sync;
}): Service => {
  const contextState: Service["currentEvent"]["contextState"] = {
    blockNumber: undefined!,
  };
  const clientByChainId: Service["clientByChainId"] = {};
  const contractsByChainId: Service["contractsByChainId"] = {};

  const networkByChainId = networks.reduce<Service["networkByChainId"]>(
    (acc, cur) => {
      acc[cur.chainId] = cur;
      return acc;
    },
    {},
  );

  // build contractsByChainId
  for (const source of sources) {
    if (source.type === "block") continue;

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

  // build cachedActions
  const cachedActions = buildCachedActions(contextState);

  // build clientByChainId
  for (const network of networks) {
    const transport = sync.getCachedTransport(network);
    clientByChainId[network.chainId] = createClient({
      transport,
      chain: network.chain,
      // @ts-ignore
    }).extend(cachedActions);
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
        network: { name: undefined!, chainId: undefined! },
        contracts: undefined!,
        client: undefined!,
        db: undefined!,
      },
    },
    networkByChainId,
    clientByChainId,
    contractsByChainId,
  };
};

export const processSetupEvents = async (
  indexingService: Service,
  {
    sources,
    networks,
  }: {
    sources: Source[];
    networks: Network[];
  },
): Promise<
  | { status: "error"; error: Error }
  | { status: "success" }
  | { status: "killed" }
> => {
  for (const eventName of Object.keys(indexingService.indexingFunctions)) {
    if (!eventName.endsWith(":setup")) continue;

    const [contractName] = eventName.split(":");

    for (const network of networks) {
      const source = sources.find(
        (s) =>
          s.type === "contract" &&
          s.name === contractName &&
          s.filter.chainId === network.chainId,
      )! as ContractSource;

      if (indexingService.isKilled) return { status: "killed" };
      indexingService.eventCount[eventName]!++;

      const result = await executeSetup(indexingService, {
        event: {
          type: "setup",
          chainId: network.chainId,
          checkpoint: encodeCheckpoint({
            ...zeroCheckpoint,
            chainId: BigInt(network.chainId),
            blockNumber: BigInt(source.filter.fromBlock),
          }),

          name: eventName,

          block: BigInt(source.filter.fromBlock),
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

    switch (event.type) {
      case "log": {
        indexingService.eventCount[event.name]!++;

        indexingService.common.logger.trace({
          service: "indexing",
          msg: `Started indexing function (event="${event.name}", checkpoint=${event.checkpoint})`,
        });

        const result = await executeLog(indexingService, { event });
        if (result.status !== "success") {
          return result;
        }

        indexingService.common.logger.trace({
          service: "indexing",
          msg: `Completed indexing function (event="${event.name}", checkpoint=${event.checkpoint})`,
        });

        break;
      }

      case "block": {
        indexingService.eventCount[event.name]!++;

        indexingService.common.logger.trace({
          service: "indexing",
          msg: `Started indexing function (event="${event.name}", checkpoint=${event.checkpoint})`,
        });

        const result = await executeBlock(indexingService, { event });
        if (result.status !== "success") {
          return result;
        }

        indexingService.common.logger.trace({
          service: "indexing",
          msg: `Completed indexing function (event="${event.name}", checkpoint=${event.checkpoint})`,
        });

        break;
      }

      case "callTrace": {
        indexingService.eventCount[event.name]!++;

        indexingService.common.logger.trace({
          service: "indexing",
          msg: `Started indexing function (event="${event.name}", checkpoint=${event.checkpoint})`,
        });

        const result = await executeCallTrace(indexingService, { event });
        if (result.status !== "success") {
          return result;
        }

        indexingService.common.logger.trace({
          service: "indexing",
          msg: `Completed indexing function (event="${event.name}", checkpoint=${event.checkpoint})`,
        });

        break;
      }

      default:
        never(event);
    }

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
    networkByChainId,
    contractsByChainId,
    clientByChainId,
  } = indexingService;
  const indexingFunction = indexingFunctions[event.name];
  const metricLabel = { event: event.name };

  try {
    // set currentEvent
    currentEvent.context.network.chainId = event.chainId;
    currentEvent.context.network.name = networkByChainId[event.chainId]!.name;
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
    const error = _error as Error;

    const decodedCheckpoint = decodeCheckpoint(event.checkpoint);

    addStackTrace(error, common.options);

    common.metrics.ponder_indexing_has_error.set(1);

    common.logger.error({
      service: "indexing",
      msg: `Error while processing '${event.name}' event in '${networkByChainId[event.chainId]!.name}' block ${decodedCheckpoint.blockNumber}`,
      error,
    });

    return { status: "error", error: error };
  }

  return { status: "success" };
};

const executeLog = async (
  indexingService: Service,
  { event }: { event: LogEvent },
): Promise<
  | { status: "error"; error: Error }
  | { status: "success" }
  | { status: "killed" }
> => {
  const {
    common,
    indexingFunctions,
    currentEvent,
    networkByChainId,
    contractsByChainId,
    clientByChainId,
  } = indexingService;
  const indexingFunction = indexingFunctions[event.name];
  const metricLabel = { event: event.name };

  try {
    // set currentEvent
    currentEvent.context.network.chainId = event.chainId;
    currentEvent.context.network.name = networkByChainId[event.chainId]!.name;
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
    const error = _error as Error & { meta?: string[] };

    const decodedCheckpoint = decodeCheckpoint(event.checkpoint);

    addStackTrace(error, common.options);

    error.meta = Array.isArray(error.meta) ? error.meta : [];
    if (error.meta.length === 0) {
      error.meta.push(`Event arguments:\n${prettyPrint(event.event.args)}`);
    }

    common.logger.error({
      service: "indexing",
      msg: `Error while processing '${event.name}' event in '${networkByChainId[event.chainId]!.name}' block ${decodedCheckpoint.blockNumber}`,
      error,
    });

    common.metrics.ponder_indexing_has_error.set(1);

    return { status: "error", error };
  }

  return { status: "success" };
};

const executeBlock = async (
  indexingService: Service,
  { event }: { event: BlockEvent },
): Promise<
  | { status: "error"; error: Error }
  | { status: "success" }
  | { status: "killed" }
> => {
  const {
    common,
    indexingFunctions,
    currentEvent,
    networkByChainId,
    contractsByChainId,
    clientByChainId,
  } = indexingService;
  const indexingFunction = indexingFunctions[event.name];
  const metricLabel = { event: event.name };

  try {
    // set currentEvent
    currentEvent.context.network.chainId = event.chainId;
    currentEvent.context.network.name = networkByChainId[event.chainId]!.name;
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
    const error = _error as Error & { meta?: string[] };

    const decodedCheckpoint = decodeCheckpoint(event.checkpoint);

    addStackTrace(error, common.options);

    error.meta = Array.isArray(error.meta) ? error.meta : [];
    error.meta.push(
      `Block:\n${prettyPrint({
        hash: event.event.block.hash,
        number: event.event.block.number,
        timestamp: event.event.block.timestamp,
      })}`,
    );

    common.logger.error({
      service: "indexing",
      msg: `Error while processing ${event.name} event at chainId=${decodedCheckpoint.chainId}, block=${decodedCheckpoint.blockNumber}`,
      error,
    });

    common.metrics.ponder_indexing_has_error.set(1);

    return { status: "error", error: error };
  }

  return { status: "success" };
};

const executeCallTrace = async (
  indexingService: Service,
  { event }: { event: CallTraceEvent },
): Promise<
  | { status: "error"; error: Error }
  | { status: "success" }
  | { status: "killed" }
> => {
  const {
    common,
    indexingFunctions,
    currentEvent,
    networkByChainId,
    contractsByChainId,
    clientByChainId,
  } = indexingService;
  const indexingFunction = indexingFunctions[event.name];
  const metricLabel = { event: event.name };

  try {
    // set currentEvent
    currentEvent.context.network.chainId = event.chainId;
    currentEvent.context.network.name = networkByChainId[event.chainId]!.name;
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
    const error = _error as Error & { meta?: string[] };

    const decodedCheckpoint = decodeCheckpoint(event.checkpoint);

    addStackTrace(error, common.options);

    error.meta = Array.isArray(error.meta) ? error.meta : [];
    error.meta.push(`Call trace arguments:\n${prettyPrint(event.event.args)}`);

    common.logger.error({
      service: "indexing",
      msg: `Error while processing '${event.name}' event in '${networkByChainId[event.chainId]!.name}' block ${decodedCheckpoint.blockNumber}`,
      error,
    });

    common.metrics.ponder_indexing_has_error.set(1);

    return { status: "error", error: error };
  }

  return { status: "success" };
};
