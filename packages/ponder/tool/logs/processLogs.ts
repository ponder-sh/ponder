import type { JsonRpcProvider, Log } from "@ethersproject/providers";
import { BigNumber, Contract } from "ethers";
import fastq from "fastq";

import { HandlerContext } from "../buildHandlerContext";
import { getProviderForSource } from "../helpers";
import type { PonderConfig } from "../readUserConfig";
import { UserHandlers } from "../readUserHandlers";
import { fetchLogs } from "./fetchLogs";

// on startup
// 	load log cache metadata into memory
// 	for each source (or provider?)
// 		register listener that just adds logs to a queue
// 		store “starting block” of listener
// 		// load historical logs into memory
// 		fetch logs from historical end to “starting block”, append to historical
// 		push full log history to ?front of queue
// 		let her rip!!!
// 		// write full log history back to disk, including metadata

type HistoricalLogData = {
  fromBlock: number;
  toBlock: number;
  logs: Log[];
};

type HistoricalLogCache = { [key: string]: HistoricalLogData | undefined };

const fetchAndProcessLogs = async (
  config: PonderConfig,
  userHandlers: UserHandlers,
  handlerContext: HandlerContext
) => {
  // STEP 1: Create log worker function in closure
  const worker = async (log: Log) => {
    console.log(
      "processing log with block number:",
      BigNumber.from(log.blockNumber).toNumber()
    );

    const source = config.sources.find(
      (source) => source.address === log.address
    );
    if (!source) {
      throw new Error(`Source not found for log with address: ${log.address}`);
    }

    const parsedLog = source.abiInterface.parseLog(log);
    const params = { ...parsedLog.args };

    const sourceHandlers = userHandlers[source.name];
    if (!sourceHandlers) {
      throw new Error(`Handlers not found for source: ${source.name}`);
    }

    const handler = sourceHandlers[parsedLog.name];
    if (!handler) {
      throw new Error(
        `Handler not found for event: ${source.name}-${parsedLog.name}`
      );
    }

    // YAY we're running user code here!
    handler(params, handlerContext);
  };

  const historicalLogCache: HistoricalLogCache = {};

  for (const source of config.sources) {
    const historicalLogData = await createNewFilterForSource(
      config,
      source,
      worker
    );

    historicalLogCache[source.address] = historicalLogData;
  }
};

const createNewFilterForSource = async (
  config: PonderConfig,
  source: PonderConfig["sources"][0],
  worker: (log: Log) => Promise<void>
): Promise<HistoricalLogData> => {
  const provider = getProviderForSource(config, source);
  const contract = new Contract(source.address, source.abiInterface, provider);

  // TODO: Make this entire method work on a per-provider basis
  // instead of per-contract (AKA per-source)
  const contracts = [contract.address];

  // STEP 1: Set up new filter
  const { filterStartBlock, filterId } = await createNewFilter(
    provider,
    contracts
  );

  // STEP 2: Set up the log queue, paused to start
  const queue = fastq.promise(worker, 1);
  queue.pause();

  // STEP 3: Register a block handler that adds new logs to the (paused) queue
  await registerBlockHandler(provider, filterId, queue);

  // STEP 4: Fetch hisorical logs up until the start of the filter
  const fromBlock = 0;
  const toBlock = filterStartBlock;
  const historicalLogs = await fetchLogs(
    provider,
    contracts,
    fromBlock,
    toBlock
  );

  // STEP 5: Add historical logs to the front of the queue
  for (let i = historicalLogs.length - 1; i >= 0; i--) {
    const log = historicalLogs[i];
    queue.unshift(log);
  }

  // STEP 6: Let it rip
  queue.resume();

  // STEP 7: Write historical log data to disk
  const historicalLogData: HistoricalLogData = {
    fromBlock: fromBlock,
    toBlock: filterStartBlock,
    logs: historicalLogs,
  };

  return historicalLogData;
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

export { fetchAndProcessLogs };
