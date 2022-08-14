import type { Log } from "@ethersproject/providers";
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
  const historicalLogCache: HistoricalLogCache = {};

  for (const source of config.sources) {
    const historicalLogData = await createNewFilterForSource(config, source);

    historicalLogCache[source.address] = historicalLogData;
  }
};

const createNewFilterForSource = async (
  config: PonderConfig,
  source: PonderConfig["sources"][0]
): Promise<HistoricalLogData> => {
  const provider = getProviderForSource(config, source);
  const contract = new Contract(source.address, source.abiInterface, provider);

  // STEP 1: Set up new filter
  const latestBlock = await provider.getBlock("latest");
  const filterStartBlock = latestBlock.number;

  const filterId: string = await provider.send("eth_newFilter", [
    {
      fromBlock: BigNumber.from(filterStartBlock).toHexString(),
      address: [contract.address],
    },
  ]);

  // STEP 2: Set up the log queue
  const worker = async (log: Log) => {
    console.log(
      "processing log with block number:",
      BigNumber.from(log.blockNumber).toNumber()
    );
  };

  const queue = fastq.promise(worker, 1);
  queue.pause();

  // STEP 3: Register a block handler that adds new logs to the (paused) queue
  const blockHandler = async () => {
    const logs: Log[] = await provider.send("eth_getFilterChanges", [filterId]);

    logs.forEach((log) => {
      console.log("in blockHandler, pushing log to queue");
      queue.push(log);
    });
  };

  provider.on("block", blockHandler);

  // STEP 4: Fetch hisorical logs up until the start of the filter
  const fromBlock = 0;
  const historicalLogs = await fetchLogs({
    provider,
    contracts: [contract.address],
    fromBlock: fromBlock,
    toBlock: filterStartBlock,
  });

  // STEP 5: Add historical logs to the front of the queue
  for (let i = historicalLogs.length - 1; i >= 0; i--) {
    const log = historicalLogs[i];
    queue.unshift(log);
  }

  // STEP 6: Let it rip
  queue.resume();

  // STEP 7: Write historical log data to disk
  const historicalLogData = {
    fromBlock: fromBlock,
    toBlock: filterStartBlock,
    logs: historicalLogs,
  };

  return historicalLogData;
};

export { fetchAndProcessLogs };
