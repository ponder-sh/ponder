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

const fetchAndProcessLogs = async (
  config: PonderConfig,
  userHandlers: UserHandlers,
  handlerContext: HandlerContext
) => {
  // STEP 1: Create log worker function in closure using userHandlers and handlerContext
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

  const logCache = await readLogCache();

  // NOTE: To support multiple providers/chains, we will need to be
  // more deliberate about the order in which logs get added to the queue.
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

    // STEP 1: Set up new filter
    const { filterStartBlock, filterId } = await createNewFilter(
      provider,
      contracts
    );

    // STEP 3: Register a block handler that adds new logs to the (paused) queue
    await registerBlockHandler(provider, filterId, queue);

    // STEP 4: Fetch new historical logs from the end of the cache to latest

    // Calculate fromBlock based on logCache.
    // Could attempt to set sourceStartBlock to contract deployment block instead of 0.
    const sourceStartBlock = 0;
    let fromBlock = sourceStartBlock;
    const cachedLogData = logCache[source.address];
    if (cachedLogData) {
      fromBlock = cachedLogData.toBlock;
    }

    const toBlock = filterStartBlock;
    const newLogs = await fetchLogs(provider, contracts, fromBlock, toBlock);

    // STEP 5: Combine cached logs and new historical logs.
    // TODO: De-dupe and validate some shit probably.
    const historicalLogs = [...(cachedLogData?.logs || []), ...newLogs];

    // STEP 7: Add latest set of logs for this source
    logCache[source.address] = {
      fromBlock: sourceStartBlock,
      toBlock: filterStartBlock,
      logs: historicalLogs,
    };
  }

  // STEP 7: Combine and sort logs from all sources
  const sortedLogsForAllSources = Object.entries(logCache)
    .map(([, logData]) => {
      if (!logData) return [];
      return logData?.logs;
    })
    .flat()
    .sort((a, b) => getLogIndex(a) - getLogIndex(b));

  // STEP 5: Add historical logs to the front of the queue
  for (let i = sortedLogsForAllSources.length - 1; i >= 0; i--) {
    const log = sortedLogsForAllSources[i];
    queue.unshift(log);
  }

  // Side effect: Once historical logs have been fetched and process for
  // all source, write the log cache to disk.
  writeLogCache(logCache);

  // STEP 8:
  queue.resume();

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
  queue: fastq.queueAsPromised
) => {
  const blockHandler = async () => {
    const logs: Log[] = await provider.send("eth_getFilterChanges", [filterId]);

    logs.forEach((log) => {
      console.log("in blockHandler, pushing log to queue");
      queue.push(log);
    });
  };

  provider.on("block", blockHandler);
};

const getLogIndex = (log: Log) => {
  return Number(log.blockNumber) * 10000 + Number(log.logIndex);
};

export { fetchAndProcessLogs };
