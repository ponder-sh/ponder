import type { IndexingFunctions } from "@/build/functions/functions.js";
import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import { type Source } from "@/config/sources.js";
import type { IndexingStore, Row } from "@/indexing-store/store.js";
import type { Schema } from "@/schema/types.js";
import type { SyncService } from "@/sync/service.js";
import type { DatabaseModel } from "@/types/model.js";
import {
  type Checkpoint,
  decodeCheckpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { prettyPrint } from "@/utils/print.js";
import { startClock } from "@/utils/timer.js";
import type {
  Abi,
  Account,
  Address,
  Chain,
  Client,
  ContractFunctionConfig,
  GetBalanceParameters,
  GetBalanceReturnType,
  GetBytecodeParameters,
  GetBytecodeReturnType,
  GetStorageAtParameters,
  GetStorageAtReturnType,
  MulticallParameters,
  MulticallReturnType,
  ReadContractParameters,
  ReadContractReturnType,
  Transport,
} from "viem";
import { checksumAddress, createClient } from "viem";
import {
  getBalance as viemGetBalance,
  getBytecode as viemGetBytecode,
  getStorageAt as viemGetStorageAt,
  multicall as viemMulticall,
  readContract as viemReadContract,
} from "viem/actions";
import type { Event, LogEvent, SetupEvent } from "./events.js";
import {
  type BlockOptions,
  type PonderActions,
  type ReadOnlyClient,
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

export type IndexingService = {
  // static
  indexingFunctions: IndexingFunctions;
  common: Common;

  // state
  isKilled: boolean;
  eventCount: number;

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
  sourceById: { [sourceId: string]: Source };
  clientByChainId: { [chainId: number]: Context["client"] };
  contractsByChainId: { [chainId: number]: Context["contracts"] };
};

export const createIndexingService = ({
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
  sources: Source[];
  networks: Network[];
  syncService: SyncService;
  indexingStore: IndexingStore;
  schema: Schema;
}): IndexingService => {
  const contextState: IndexingService["currentEvent"]["contextState"] = {
    encodedCheckpoint: undefined!,
    blockNumber: undefined!,
  };
  const clientByChainId: IndexingService["clientByChainId"] = {};
  const contractsByChainId: IndexingService["contractsByChainId"] = {};

  const networkByChainId = networks.reduce<IndexingService["networkByChainId"]>(
    (acc, cur) => {
      acc[cur.chainId] = cur;
      return acc;
    },
    {},
  );
  const sourceById = sources.reduce<IndexingService["sourceById"]>(
    (acc, cur) => {
      acc[cur.id] = cur;
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
  const db = Object.keys(schema.tables).reduce<
    IndexingService["currentEvent"]["context"]["db"]
  >((acc, tableName) => {
    acc[tableName] = {
      findUnique: async ({ id }) => {
        common.logger.trace({
          service: "store",
          msg: `${tableName}.findUnique(id=${id})`,
        });
        return indexingStore.findUnique({
          tableName,
          id,
        });
      },
      findMany: async ({ where, orderBy, limit, before, after } = {}) => {
        common.logger.trace({
          service: "store",
          msg: `${tableName}.findMany`,
        });
        return indexingStore.findMany({
          tableName,
          where,
          orderBy,
          limit,
          before,
          after,
        });
      },
      create: async ({ id, data }) => {
        common.logger.trace({
          service: "store",
          msg: `${tableName}.create(id=${id})`,
        });
        return indexingStore.create({
          tableName,
          encodedCheckpoint: contextState.encodedCheckpoint,
          id,
          data,
        });
      },
      createMany: async ({ data }) => {
        common.logger.trace({
          service: "store",
          msg: `${tableName}.createMany(count=${data.length})`,
        });
        return indexingStore.createMany({
          tableName,
          encodedCheckpoint: contextState.encodedCheckpoint,
          data,
        });
      },
      update: async ({ id, data }) => {
        common.logger.trace({
          service: "store",
          msg: `${tableName}.update(id=${id})`,
        });
        return indexingStore.update({
          tableName,
          encodedCheckpoint: contextState.encodedCheckpoint,
          id,
          data,
        });
      },
      updateMany: async ({ where, data }) => {
        common.logger.trace({
          service: "store",
          msg: `${tableName}.updateMany`,
        });
        return indexingStore.updateMany({
          tableName,
          encodedCheckpoint: contextState.encodedCheckpoint,
          where,
          data,
        });
      },
      upsert: async ({ id, create, update }) => {
        common.logger.trace({
          service: "store",
          msg: `${tableName}.upsert(id=${id})`,
        });
        return indexingStore.upsert({
          tableName,
          encodedCheckpoint: contextState.encodedCheckpoint,
          id,
          create,
          update,
        });
      },
      delete: async ({ id }) => {
        common.logger.trace({
          service: "store",
          msg: `${tableName}.delete(id=${id})`,
        });
        return indexingStore.delete({
          tableName,
          encodedCheckpoint: contextState.encodedCheckpoint,
          id,
        });
      },
    };
    return acc;
  }, {});

  // build ponderActions
  const ponderActions = <
    TTransport extends Transport = Transport,
    TChain extends Chain | undefined = Chain | undefined,
    TAccount extends Account | undefined = Account | undefined,
  >(
    client: Client<TTransport, TChain, TAccount>,
  ): PonderActions => ({
    getBalance: ({
      cache,
      blockNumber: userBlockNumber,
      ...args
    }: Omit<GetBalanceParameters, "blockTag" | "blockNumber"> &
      BlockOptions): Promise<GetBalanceReturnType> =>
      viemGetBalance(client, {
        ...args,
        ...(cache === "immutable"
          ? { blockTag: "latest" }
          : { blockNumber: userBlockNumber ?? contextState.blockNumber }),
      }),
    getBytecode: ({
      cache,
      blockNumber: userBlockNumber,
      ...args
    }: Omit<GetBytecodeParameters, "blockTag" | "blockNumber"> &
      BlockOptions): Promise<GetBytecodeReturnType> =>
      viemGetBytecode(client, {
        ...args,
        ...(cache === "immutable"
          ? { blockTag: "latest" }
          : { blockNumber: userBlockNumber ?? contextState.blockNumber }),
      }),
    getStorageAt: ({
      cache,
      blockNumber: userBlockNumber,
      ...args
    }: Omit<GetStorageAtParameters, "blockTag" | "blockNumber"> &
      BlockOptions): Promise<GetStorageAtReturnType> =>
      viemGetStorageAt(client, {
        ...args,
        ...(cache === "immutable"
          ? { blockTag: "latest" }
          : { blockNumber: userBlockNumber ?? contextState.blockNumber }),
      }),
    multicall: <
      TContracts extends ContractFunctionConfig[],
      TAllowFailure extends boolean = true,
    >({
      cache,
      blockNumber: userBlockNumber,
      ...args
    }: Omit<
      MulticallParameters<TContracts, TAllowFailure>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions): Promise<MulticallReturnType<TContracts, TAllowFailure>> =>
      viemMulticall(client, {
        ...args,
        ...(cache === "immutable"
          ? { blockTag: "latest" }
          : { blockNumber: userBlockNumber ?? contextState.blockNumber }),
      }),
    // @ts-ignore
    readContract: <
      const TAbi extends Abi | readonly unknown[],
      TFunctionName extends string,
    >({
      cache,
      blockNumber: userBlockNumber,
      ...args
    }: Omit<
      ReadContractParameters<TAbi, TFunctionName>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions): Promise<ReadContractReturnType<TAbi, TFunctionName>> =>
      viemReadContract(client, {
        ...args,
        ...(cache === "immutable"
          ? { blockTag: "latest" }
          : { blockNumber: userBlockNumber ?? contextState.blockNumber }),
      } as ReadContractParameters<TAbi, TFunctionName>),
  });

  // build clientByChainId
  for (const network of networks) {
    const transport = syncService.getCachedTransport(network.chainId);
    clientByChainId[network.chainId] = createClient({
      transport,
      chain: network.chain,
    }).extend(ponderActions);
  }

  return {
    indexingFunctions,
    common,
    isKilled: false,
    eventCount: 0,
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
    sourceById,
    clientByChainId,
    contractsByChainId,
  };
};

export const createSetupEvents = (
  indexingService: IndexingService,
  {
    sources,
    networks,
  }: {
    sources: Source[];
    networks: Network[];
  },
): SetupEvent[] => {
  const setupEvents: SetupEvent[] = [];

  for (const contractName of Object.keys(indexingService.indexingFunctions)) {
    for (const eventName of Object.keys(
      indexingService.indexingFunctions[contractName],
    )) {
      if (eventName !== "setup") continue;

      for (const network of networks) {
        const source = sources.find(
          (s) =>
            s.contractName === contractName && s.chainId === network.chainId,
        )!;

        setupEvents.push({
          type: "setup",
          chainId: network.chainId,
          contractName: source.contractName,
          eventName: "setup",
          startBlock: BigInt(source.startBlock),
          encodedCheckpoint: encodeCheckpoint({
            ...zeroCheckpoint,
            chainId: network.chainId,
            blockNumber: source.startBlock,
          }),
        });
      }
    }
  }

  return setupEvents;
};

export const processEvents = async (
  indexingService: IndexingService,
  {
    events,
    firstEventCheckpoint,
  }: { events: Event[]; firstEventCheckpoint: Checkpoint },
): Promise<{ success: false } | { success: true }> => {
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (indexingService.isKilled) return { success: false };

    indexingService.eventCount++;

    const neva = (_x: never) => {
      throw "unreachable";
    };

    switch (event.type) {
      case "setup": {
        const result = await executeSetup(indexingService, { event });
        if (result.success === false) {
          // TODO(kyle) log

          return { success: false };
        }
        break;
      }

      case "log": {
        const result = await executeLog(indexingService, { event });
        if (result.success === false) {
          // TODO(kyle) log

          return { success: false };
        }
        break;
      }

      default:
        neva(event);
    }

    if (i % 93 === 0) {
      updateEventCount(indexingService);
      updateCompletedSeconds(indexingService, {
        firstEventCheckpoint,
        completedEventCheckpoint: decodeCheckpoint(event.encodedCheckpoint),
      });
      await new Promise(setImmediate);
    }
  }

  return { success: true };
};

export const kill = (indexingService: IndexingService) => {
  indexingService.isKilled = true;
};

export const updateCompletedSeconds = (
  { common }: Pick<IndexingService, "common">,
  {
    firstEventCheckpoint,
    completedEventCheckpoint,
  }: {
    firstEventCheckpoint: Pick<Checkpoint, "blockTimestamp">;
    completedEventCheckpoint: Pick<Checkpoint, "blockTimestamp">;
  },
) => {
  common.metrics.ponder_indexing_completed_seconds.set(
    completedEventCheckpoint.blockTimestamp -
      firstEventCheckpoint.blockTimestamp,
  );
};

export const updateTotalSeconds = (
  { common }: Pick<IndexingService, "common">,
  {
    firstEventCheckpoint,
    lastEventCheckpoint,
  }: {
    firstEventCheckpoint: Pick<Checkpoint, "blockTimestamp">;
    lastEventCheckpoint: Pick<Checkpoint, "blockTimestamp">;
  },
) => {
  common.metrics.ponder_indexing_total_seconds.set(
    lastEventCheckpoint.blockTimestamp - firstEventCheckpoint.blockTimestamp,
  );
};

export const updateEventCount = ({
  common,
  eventCount,
}: Pick<IndexingService, "common" | "eventCount">) => {
  common.metrics.ponder_indexing_completed_events.set(eventCount);
};

// TODO(kyle) handle errors thrown

const executeSetup = async (
  indexingService: IndexingService,
  { event }: { event: SetupEvent },
): Promise<{ success: true } | { success: false; error: Error }> => {
  const {
    common,
    indexingFunctions,
    currentEvent,
    networkByChainId,
    contractsByChainId,
    clientByChainId,
  } = indexingService;
  const indexingFunction =
    indexingFunctions[event.contractName][event.eventName];

  const metricLabel = {
    event: event.eventName,
    network: networkByChainId[event.chainId].name,
  };

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
    const error = error_ as Error & { meta?: string };

    common.metrics.ponder_indexing_function_error_total.inc(metricLabel);

    addUserStackTrace(error, common.options);

    common.logger.error({
      service: "indexing",
      msg: `Error while processing "${event.contractName}:${event.eventName}" event at checkpoint=${event.encodedCheckpoint}: `,
      error,
    });

    common.metrics.ponder_indexing_has_error.set(1);
    return { success: false, error: error };
  }

  return { success: true };
};

const executeLog = async (
  indexingService: IndexingService,
  { event }: { event: LogEvent },
): Promise<{ success: true } | { success: false; error: Error }> => {
  const {
    common,
    indexingFunctions,
    currentEvent,
    networkByChainId,
    contractsByChainId,
    clientByChainId,
  } = indexingService;
  const indexingFunction =
    indexingFunctions[event.contractName][event.eventName];

  const metricLabel = {
    event: event.eventName,
    network: networkByChainId[event.chainId].name,
  };

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
        name: event.eventName,
        args: event.event.args,
        log: event.event.log,
        block: event.event.block,
        transaction: event.event.transaction,
      },
      context: currentEvent.context,
    });

    common.metrics.ponder_indexing_function_duration.observe(
      metricLabel,
      endClock(),
    );
  } catch (error_) {
    const error = error_ as Error & { meta?: string };

    common.metrics.ponder_indexing_function_error_total.inc(metricLabel);

    addUserStackTrace(error, common.options);

    if (error.meta) {
      error.meta += `\nEvent args:\n${prettyPrint(event.event.args)}`;
    } else {
      error.meta = `Event args:\n${prettyPrint(event.event.args)}`;
    }

    common.logger.error({
      service: "indexing",
      msg: `Error while processing "${event.contractName}:${event.eventName}" event at checkpoint=${event.encodedCheckpoint}: `,
      error,
    });

    common.metrics.ponder_indexing_has_error.set(1);

    return { success: false, error: error };
  }

  return { success: true };
};
