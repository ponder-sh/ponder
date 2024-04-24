import type { IndexingFunctions } from "@/build/configAndIndexingFunctions.js";
import type { Common } from "@/common/common.js";
import { getBaseError } from "@/common/errors.js";
import type { Network } from "@/config/networks.js";
import { type EventSource } from "@/config/sources.js";
import type { IndexingStore, Row } from "@/indexing-store/store.js";
import type { Schema } from "@/schema/types.js";
import type { SyncService } from "@/sync/index.js";
import type { DatabaseModel } from "@/types/model.js";
import {
  type Checkpoint,
  decodeCheckpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { prettyPrint } from "@/utils/print.js";
import { startClock } from "@/utils/timer.js";
import type { Abi, Address } from "viem";
import { checksumAddress, createClient } from "viem";
import type { Event, LogEvent, SetupEvent } from "../sync/events.js";
import {
  type ReadOnlyClient,
  buildCachedActions,
  buildDb,
} from "./ponderActions.js";
import { addUserStackTrace } from "./trace.js";

export type Context = {
  network: { chainId: number; name: string };
  client: ReadOnlyClient;
  db: Record<string, DatabaseModel<Row>>;
  contracts: Record<
    string,
    {
      abi: Abi;
      address?: Address | readonly Address[];
      startBlock: number;
      endBlock?: number;
      maxBlockRange?: number;
    }
  >;
};

export type Service = {
  // static
  common: Common;
  indexingFunctions: IndexingFunctions;
  indexingStore: IndexingStore;

  // state
  isKilled: boolean;

  eventCount: {
    [eventName: string]: { [networkName: string]: number };
  };
  firstEventCheckpoint: Checkpoint | undefined;
  lastEventCheckpoint: Checkpoint | undefined;

  /**
   * Reduce memory usage by reserving space for objects ahead of time
   * instead of creating a new one for each event.
   */
  currentEvent: {
    contextState: {
      encodedCheckpoint: string;
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
  syncService,
  indexingStore,
  schema,
}: {
  indexingFunctions: IndexingFunctions;
  common: Common;
  sources: EventSource[];
  networks: Network[];
  syncService: SyncService;
  indexingStore: IndexingStore;
  schema: Schema;
}): Service => {
  const contextState: Service["currentEvent"]["contextState"] = {
    encodedCheckpoint: undefined!,
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
    const address =
      typeof source.criteria.address === "string"
        ? source.criteria.address
        : undefined;

    if (contractsByChainId[source.chainId] === undefined) {
      contractsByChainId[source.chainId] = {};
    }

    contractsByChainId[source.chainId][source.contractName] = {
      abi: source.abi,
      address: address ? checksumAddress(address) : address,
      startBlock: source.startBlock,
      endBlock: source.endBlock,
      maxBlockRange: source.maxBlockRange,
    };
  }

  // build db
  const db = buildDb({ common, schema, indexingStore, contextState });

  // build cachedActions
  const cachedActions = buildCachedActions(contextState);

  // build clientByChainId
  for (const network of networks) {
    const transport = syncService.getCachedTransport(network);
    clientByChainId[network.chainId] = createClient({
      transport,
      chain: network.chain,
    }).extend(cachedActions);
  }

  // build eventCount
  const eventCount: Service["eventCount"] = {};
  for (const eventName of Object.keys(indexingFunctions)) {
    eventCount[eventName] = {};
    for (const network of networks) {
      eventCount[eventName][network.name] = 0;
    }
  }

  return {
    common,
    indexingFunctions,
    indexingStore,
    isKilled: false,
    eventCount,
    firstEventCheckpoint: undefined,
    lastEventCheckpoint: undefined,
    currentEvent: {
      contextState,
      context: {
        network: { name: undefined!, chainId: undefined! },
        contracts: undefined!,
        client: undefined!,
        db,
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
    sources: EventSource[];
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
        (s) => s.contractName === contractName && s.chainId === network.chainId,
      )!;

      if (indexingService.isKilled) return { status: "killed" };
      indexingService.eventCount[eventName][source.networkName]++;

      const result = await executeSetup(indexingService, {
        event: {
          type: "setup",
          chainId: network.chainId,
          contractName: source.contractName,
          startBlock: BigInt(source.startBlock),
          encodedCheckpoint: encodeCheckpoint({
            ...zeroCheckpoint,
            chainId: network.chainId,
            blockNumber: source.startBlock,
          }),
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
  // set first event checkpoint
  if (events.length > 0 && indexingService.firstEventCheckpoint === undefined) {
    indexingService.firstEventCheckpoint = decodeCheckpoint(
      events[0].encodedCheckpoint,
    );

    // set total seconds
    if (indexingService.lastEventCheckpoint !== undefined) {
      indexingService.common.metrics.ponder_indexing_total_seconds.set(
        indexingService.lastEventCheckpoint.blockTimestamp -
          indexingService.firstEventCheckpoint.blockTimestamp,
      );
    }
  }

  const eventCounts: { [eventName: string]: number } = {};

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const eventName = `${event.contractName}:${event.logEventName}`;

    if (indexingService.isKilled) return { status: "killed" };
    indexingService.eventCount[eventName][
      indexingService.networkByChainId[event.chainId].name
    ]++;

    indexingService.common.logger.trace({
      service: "indexing",
      msg: `Started indexing function (event="${eventName}", checkpoint=${event.encodedCheckpoint})`,
    });

    switch (event.type) {
      case "log": {
        const result = await executeLog(indexingService, { event });
        if (result.status !== "success") {
          return result;
        }
        break;
      }
    }

    if (eventCounts[eventName] === undefined) eventCounts[eventName] = 0;
    else eventCounts[eventName]++;

    indexingService.common.logger.trace({
      service: "indexing",
      msg: `Completed indexing function (event="${eventName}", checkpoint=${event.encodedCheckpoint})`,
    });

    // periodically update metrics
    if (i % 93 === 0) {
      updateCompletedEvents(indexingService);

      indexingService.common.metrics.ponder_indexing_completed_seconds.set(
        decodeCheckpoint(event.encodedCheckpoint).blockTimestamp -
          indexingService.firstEventCheckpoint!.blockTimestamp,
      );

      // Note(kyle) this is only needed for sqlite
      await new Promise(setImmediate);
    }
  }

  // set completed seconds
  if (
    events.length > 0 &&
    indexingService.firstEventCheckpoint !== undefined &&
    indexingService.lastEventCheckpoint !== undefined
  ) {
    indexingService.common.metrics.ponder_indexing_completed_seconds.set(
      decodeCheckpoint(events[events.length - 1].encodedCheckpoint)
        .blockTimestamp - indexingService.firstEventCheckpoint.blockTimestamp,
    );
  }
  // set completed events
  updateCompletedEvents(indexingService);

  for (const [eventName, count] of Object.entries(eventCounts)) {
    if (count === 1) {
      indexingService.common.logger.info({
        service: "indexing",
        msg: `Indexed 1 '${eventName}' event`,
      });
    } else {
      indexingService.common.logger.info({
        service: "indexing",
        msg: `Indexed ${count} '${eventName}' events`,
      });
    }
  }

  return { status: "success" };
};

export const kill = (indexingService: Service) => {
  indexingService.common.logger.debug({
    service: "indexing",
    msg: "Killed indexing service",
  });
  indexingService.isKilled = true;
};

export const updateLastEventCheckpoint = (
  indexingService: Service,
  lastEventCheckpoint: Checkpoint,
) => {
  indexingService.lastEventCheckpoint = lastEventCheckpoint;

  if (indexingService.firstEventCheckpoint !== undefined) {
    indexingService.common.metrics.ponder_indexing_total_seconds.set(
      indexingService.lastEventCheckpoint.blockTimestamp -
        indexingService.firstEventCheckpoint.blockTimestamp,
    );
  }
};

const updateCompletedEvents = (indexingService: Service) => {
  for (const event of Object.keys(indexingService.eventCount)) {
    for (const network of Object.keys(indexingService.eventCount[event])) {
      const metricLabel = {
        event,
        network,
      };
      indexingService.common.metrics.ponder_indexing_completed_events.set(
        metricLabel,
        indexingService.eventCount[event][network],
      );
    }
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
  const eventName = `${event.contractName}:setup`;
  const indexingFunction = indexingFunctions[eventName];

  const networkName = networkByChainId[event.chainId].name;
  const metricLabel = { event: eventName, network: networkName };

  try {
    // set currentEvent
    currentEvent.context.network.chainId = event.chainId;
    currentEvent.context.network.name = networkByChainId[event.chainId].name;
    currentEvent.context.client = clientByChainId[event.chainId];
    currentEvent.context.contracts = contractsByChainId[event.chainId];
    currentEvent.contextState.encodedCheckpoint = event.encodedCheckpoint;
    currentEvent.contextState.blockNumber = event.startBlock;

    const endClock = startClock();

    await indexingFunction({
      context: currentEvent.context,
    });

    common.metrics.ponder_indexing_function_duration.observe(
      metricLabel,
      endClock(),
    );
  } catch (error_) {
    if (indexingService.isKilled) return { status: "killed" };
    const error = getBaseError(error_);

    common.metrics.ponder_indexing_function_error_total.inc(metricLabel);

    const decodedCheckpoint = decodeCheckpoint(event.encodedCheckpoint);

    addUserStackTrace(error, common.options);

    common.metrics.ponder_indexing_has_error.set(1);

    common.logger.error({
      service: "indexing",
      msg: `Error while processing '${eventName}' event in '${networkName}' block ${decodedCheckpoint.blockNumber}`,
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
  const eventName = `${event.contractName}:${event.logEventName}`;
  const indexingFunction = indexingFunctions[eventName];

  const networkName = networkByChainId[event.chainId].name;
  const metricLabel = { event: eventName, network: networkName };

  try {
    // set currentEvent
    currentEvent.context.network.chainId = event.chainId;
    currentEvent.context.network.name = networkByChainId[event.chainId].name;
    currentEvent.context.client = clientByChainId[event.chainId];
    currentEvent.context.contracts = contractsByChainId[event.chainId];
    currentEvent.contextState.encodedCheckpoint = event.encodedCheckpoint;
    currentEvent.contextState.blockNumber = event.event.block.number;

    const endClock = startClock();

    await indexingFunction({
      event: {
        name: event.logEventName,
        args: event.event.args,
        log: event.event.log,
        block: event.event.block,
        transaction: event.event.transaction,
        transactionReceipt: event.event.transactionReceipt,
      },
      context: currentEvent.context,
    });

    common.metrics.ponder_indexing_function_duration.observe(
      metricLabel,
      endClock(),
    );
  } catch (error_) {
    if (indexingService.isKilled) return { status: "killed" };
    const error = getBaseError(error_);

    common.metrics.ponder_indexing_function_error_total.inc(metricLabel);

    const decodedCheckpoint = decodeCheckpoint(event.encodedCheckpoint);

    error.meta.push(`Event arguments:\n${prettyPrint(event.event.args)}`);

    addUserStackTrace(error, common.options);

    common.logger.error({
      service: "indexing",
      msg: `Error while processing '${eventName}' event in '${networkName}' block ${decodedCheckpoint.blockNumber}`,
      error,
    });

    common.metrics.ponder_indexing_has_error.set(1);

    return { status: "error", error: error };
  }

  return { status: "success" };
};
