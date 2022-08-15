import type { JsonRpcProvider, Log } from "@ethersproject/providers";
import { BigNumber } from "ethers";
import fastq from "fastq";

import { HandlerContext } from "../buildHandlerContext";
import { getProviderForChainId } from "../helpers";
import type { PonderConfig } from "../readUserConfig";
import { UserHandlers } from "../readUserHandlers";
import { fetchLogs } from "./fetchLogs";
import { readLogCache, writeLogCache } from "./logCache";

type LogQueue = fastq.queueAsPromised<Log>;

type LogProvider = {
  chainId: number;
  provider: JsonRpcProvider;
  contracts: string[];
  cacheKey: string;
};

const fetchAndProcessLogs = async (
  config: PonderConfig,
  userHandlers: UserHandlers,
  handlerContext: HandlerContext
) => {
  // NOTE: This function should probably come as a standalone param.
  const worker = async (log: Log) => {
    const source = config.sources.find(
      (source) => source.address === log.address
    );
    if (!source) {
      console.log(`Source not found for log with address: ${log.address}`);
      return;
    }

    const parsedLog = source.abiInterface.parseLog(log);
    const params = { ...parsedLog.args };

    const sourceHandlers = userHandlers[source.name];
    if (!sourceHandlers) {
      console.log(`Handlers not found for source: ${source.name}`);
      return;
    }

    const handler = sourceHandlers[parsedLog.name];
    if (!handler) {
      // console.log(
      //   `Handler not found for event: ${source.name}-${parsedLog.name}`
      // );
      return;
    }

    // const logBlockNumber = BigNumber.from(log.blockNumber).toNumber();
    // console.log(`Processing ${parsedLog.name} from block ${logBlockNumber}`);

    // YAY: We're running user code here!
    await handler(params, handlerContext);
  };

  // Indexing runs on a per-provider basis so we can batch eth_getLogs calls across contracts.
  const uniqueChainIds = [...new Set(config.sources.map((s) => s.chainId))];
  const logProviders: LogProvider[] = uniqueChainIds.map((chainId) => {
    const provider = getProviderForChainId(config, chainId);
    const contracts = config.sources
      .filter((source) => source.chainId === chainId)
      .map((source) => source.address);
    const cacheKey = `${chainId}${contracts.map((contract) => `-${contract}`)}`;

    return { chainId, provider, contracts, cacheKey };
  });

  // Read cached logs from disk.
  const logCache = await readLogCache();

  // Create a queue which we will add logs to (paused at first).
  const queue = fastq.promise(worker, 1);
  queue.pause();

  // TODO: Make this work on a per-provider basis
  // instead of per-contract/source, should reduce RPC usage
  for (const logProvider of logProviders) {
    const { provider, contracts, cacheKey } = logProvider;

    // Call eth_newFilter for all events emitted by the specified contracts.
    const { filterStartBlock, filterId } = await createNewFilter(logProvider);

    // Register a block listener that adds new logs to the queue.
    registerBlockListener(logProvider, filterId, queue);

    // Get cached log data for this source (may be empty/undefined).
    const cachedLogData = logCache[cacheKey];

    // Calculate fromBlock to pick up where the cached logs end.
    // NOTE: Could optimize this to use the contract deployment block.
    const sourceStartBlock = 0;
    const fromBlock = cachedLogData ? cachedLogData.toBlock : sourceStartBlock;

    // Get logs between the end of the cached logs and the beginning of the active filter.
    const toBlock = filterStartBlock;
    const newLogs = await fetchLogs(provider, contracts, fromBlock, toBlock);

    // Combine cached logs and new logs to get the full list of historical logs.
    // TODO: De-dupe and validate some shit probably?
    const historicalLogs = [...(cachedLogData?.logs || []), ...newLogs];

    // Add the full list of historical logs to the cache.
    logCache[cacheKey] = {
      fromBlock: sourceStartBlock,
      toBlock: filterStartBlock,
      logs: historicalLogs,
    };
  }

  // Side effect: Now that the historical logs have been fetched
  // for all sources, write the updated log cache to disk.
  writeLogCache(logCache);

  // Combine and sort logs from all sources.
  // Filter out logs present in the cache that are not part of the current set of logs.
  const latestRunCacheKeys = new Set(logProviders.map((p) => p.cacheKey));
  const sortedLogsForAllSources = Object.entries(logCache)
    .filter(([cacheKey]) => latestRunCacheKeys.has(cacheKey))
    .map(([, logData]) => logData?.logs || [])
    .flat()
    .sort((a, b) => getLogIndex(a) - getLogIndex(b));

  // Add sorted historical logs to the front of the queue.
  for (let i = sortedLogsForAllSources.length - 1; i >= 0; i--) {
    const log = sortedLogsForAllSources[i];
    queue.unshift(log);
  }

  // Begin processing logs in the correct order.
  queue.resume();

  // NOTE: Awaiting the queue to be drained allows callers to take action once
  // all historical logs have been fetched and processed (indexing is complete).
  await queue.drained();
};

const createNewFilter = async (logProvider: LogProvider) => {
  const { provider, contracts } = logProvider;

  const latestBlock = await provider.getBlock("latest");
  const filterStartBlock = latestBlock.number;

  const filterId: string = await provider.send("eth_newFilter", [
    {
      fromBlock: BigNumber.from(filterStartBlock).toHexString(),
      address: contracts,
    },
  ]);

  return { filterStartBlock, filterId };
};

const blockHandlers: { [key: string]: () => Promise<void> | undefined } = {};

const registerBlockListener = (
  logProvider: LogProvider,
  filterId: string,
  queue: LogQueue
) => {
  const { cacheKey, provider } = logProvider;

  // If a block listener was already registered for this provider, remove it.
  const oldBlockHandler = blockHandlers[cacheKey];
  if (oldBlockHandler) {
    provider.off("block", oldBlockHandler);
  }

  const blockHandler = async () => {
    const logs: Log[] = await provider.send("eth_getFilterChanges", [filterId]);
    logs.forEach(queue.push);
  };
  provider.on("block", blockHandler);

  blockHandlers[cacheKey] = blockHandler;
};

const getLogIndex = (log: Log) => {
  return Number(log.blockNumber) * 10000 + Number(log.logIndex);
};

export { fetchAndProcessLogs };
