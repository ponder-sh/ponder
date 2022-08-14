import type { JsonRpcProvider, Log } from "@ethersproject/providers";
import { BigNumber, Contract } from "ethers";
import fastq from "fastq";

import { HandlerContext } from "../buildHandlerContext";
import { getProviderForSource } from "../helpers";
import type { PonderConfig } from "../readUserConfig";
import { UserHandlers } from "../readUserHandlers";
import { fetchLogs } from "./fetchLogs";
import { readLogCache, writeLogCache } from "./logCache";

// on startup
// 	load log cache into memory
// 	for each source (or provider?)
// 		register listener that just adds logs to a queue, store fromBlock
// 		load historicalLogs into memory
// 		fetch newLogs (from end of historicalLogs to start of listener)
//    append newLogs to historicalLogs
// 		push full log history to ?front of queue
// 		let her rip!!!
// 		write full log history back to disk, including metadata

type LogQueue = fastq.queueAsPromised<Log>;

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

  // Read cached logs from disk.
  const logCache = await readLogCache();

  // Create a queue which we will add logs to (paused at first).
  const queue = fastq.promise(worker, 1);
  queue.pause();

  // TODO: Make this work on a per-provider basis
  // instead of per-contract/source, should reduce RPC usage
  for (const source of config.sources) {
    const provider = getProviderForSource(config, source);
    const contract = new Contract(
      source.address,
      source.abiInterface,
      provider
    );
    const contracts = [contract.address];

    // Call eth_newFilter for all events emitted by the specified contracts.
    const { filterStartBlock, filterId } = await createNewFilter(
      provider,
      contracts
    );

    // Register a block handler that adds new logs to the (paused) queue
    await registerBlockHandler(provider, filterId, queue);

    // Get cached log data for this source (may be empty/undefined).
    const cachedLogData = logCache[source.address];

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
    logCache[source.address] = {
      fromBlock: sourceStartBlock,
      toBlock: filterStartBlock,
      logs: historicalLogs,
    };
  }

  // Side effect: Now that the historical logs have been fetched
  // for all sources, write the updated log cache to disk.
  writeLogCache(logCache);

  // Combine and sort logs from all sources.
  const sortedLogsForAllSources = Object.entries(logCache)
    .map(([, logData]) => {
      if (!logData) return [];
      return logData?.logs;
    })
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

const createNewFilter = async (
  provider: JsonRpcProvider,
  contracts: string[]
) => {
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

const registerBlockHandler = async (
  provider: JsonRpcProvider,
  filterId: string,
  queue: LogQueue
) => {
  const blockHandler = async () => {
    const logs: Log[] = await provider.send("eth_getFilterChanges", [filterId]);
    logs.forEach(queue.push);
  };

  provider.on("block", blockHandler);
};

const getLogIndex = (log: Log) => {
  return Number(log.blockNumber) * 10000 + Number(log.logIndex);
};

export { fetchAndProcessLogs };
