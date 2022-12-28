import { BigNumber } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import { parseBlock, parseLog } from "@/db/cache/utils";
import type { Ponder } from "@/Ponder";
import type { Source } from "@/sources/base";

import type { BlockBackfillQueue } from "./blockBackfillQueue";

export type LogBackfillTask = {
  contractAddresses: string[];
  fromBlock: number;
  toBlock: number;
};

export type LogBackfillWorkerContext = {
  ponder: Ponder;
  source: Source;
  blockBackfillQueue: BlockBackfillQueue;
};

export type LogBackfillQueue = fastq.queueAsPromised<LogBackfillTask>;

export const createLogBackfillQueue = ({
  ponder,
  source,
  blockBackfillQueue,
}: LogBackfillWorkerContext) => {
  // Queue for fetching historical blocks and transactions.
  const queue = fastq.promise<LogBackfillWorkerContext, LogBackfillTask>(
    { ponder, source, blockBackfillQueue },
    logBackfillWorker,
    10 // TODO: Make this configurable
  );

  queue.error((err, task) => {
    if (err) {
      logger.debug("Error in log backfill worker, retrying...:");
      logger.debug({ task, err });
      queue.unshift(task);
    }
  });

  return queue;
};

async function logBackfillWorker(
  this: LogBackfillWorkerContext,
  { contractAddresses, fromBlock, toBlock }: LogBackfillTask
) {
  const { ponder, source, blockBackfillQueue } = this;
  const { provider } = source.network;

  const [rawLogs, rawToBlock] = await Promise.all([
    provider.send("eth_getLogs", [
      {
        address: contractAddresses,
        fromBlock: BigNumber.from(fromBlock).toHexString(),
        toBlock: BigNumber.from(toBlock).toHexString(),
      },
    ]),
    provider.send("eth_getBlockByNumber", [
      BigNumber.from(toBlock).toHexString(),
      false,
    ]),
  ]);

  // The timestamp of the toBlock is required to properly update the cached intervals below.
  const toBlockTimestamp = parseBlock(rawToBlock).timestamp;

  const logs = (rawLogs as unknown[]).map(parseLog);

  await ponder.cacheStore.insertLogs(logs);

  const txnHashesForBlockHash = logs.reduce((acc, log) => {
    if (acc[log.blockHash]) {
      if (!acc[log.blockHash].includes(log.transactionHash)) {
        acc[log.blockHash].push(log.transactionHash);
      }
    } else {
      acc[log.blockHash] = [log.transactionHash];
    }
    return acc;
  }, {} as Record<string, string[]>);

  const requiredBlockHashes = Object.keys(txnHashesForBlockHash);

  // The block request worker calls the `onSuccess` callback when it finishes. This serves as
  // a hacky way to run some code when all "child" jobs are done. In this case,
  // we want to update the contract metadata to store that this block range has been cached.

  const requiredBlockHashSet = new Set(requiredBlockHashes);

  const onSuccess = async (blockHash?: string) => {
    if (blockHash) requiredBlockHashSet.delete(blockHash);

    if (requiredBlockHashSet.size === 0) {
      await Promise.all(
        contractAddresses.map((contractAddress) =>
          ponder.cacheStore.insertCachedInterval({
            contractAddress,
            startBlock: fromBlock,
            endBlock: toBlock,
            endBlockTimestamp: toBlockTimestamp,
          })
        )
      );
      ponder.emit("backfill_newLogs");
    }
  };

  // If there are no required blocks, call the batch success callback manually
  // so we make sure to update the contract metadata accordingly.
  if (requiredBlockHashes.length === 0) {
    onSuccess();
  }

  requiredBlockHashes.forEach((blockHash) => {
    blockBackfillQueue.push({
      blockHash,
      requiredTxnHashes: txnHashesForBlockHash[blockHash],
      onSuccess,
    });
  });

  ponder.emit("backfill_tasksAdded", { taskCount: requiredBlockHashes.length });
  ponder.emit("backfill_logTaskDone");
}
