import type { Common } from "@/internal/common.js";
import type {
  Chain,
  FactoryId,
  LogFilter as InternalLogFilter,
  TraceFilter as InternalTraceFilter,
  TransferFilter as InternalTransferFilter,
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
} from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import { mapQueryResponseData } from "@/rpc/query-mappers.js";
import {
  type QueryLogsRequest,
  type QueryTracesRequest,
  eth_queryLogs,
  eth_queryTraces,
  paginate,
} from "@/rpc/query.js";
import { dedupe } from "@/utils/dedupe.js";
import { type Interval, intervalRange } from "@/utils/interval.js";
import { promiseAllSettledWithThrow } from "@/utils/promiseAllSettledWithThrow.js";
import { createQueue } from "@/utils/queue.js";
import { startClock } from "@/utils/timer.js";
import {
  type Address,
  type Hash,
  type Hex,
  type LogTopic,
  hexToNumber,
  numberToHex,
} from "viem";
import type { HistoricalSync } from "./index.js";

type CreateQueryHistoricalSyncParameters = {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  childAddresses: Map<FactoryId, Map<Address, number>>;
};

async function syncLogsForFilter(
  rpc: Rpc,
  filter: InternalLogFilter,
  filterInterval: Interval,
  chainId: number,
  syncStore: Parameters<HistoricalSync["syncBlockRangeData"]>[0]["syncStore"],
  context?: Parameters<Rpc["request"]>[1],
): Promise<SyncLog[]> {
  const topics: (LogTopic | null)[] = [
    filter.topic0 ?? null,
    filter.topic1 ?? null,
    filter.topic2 ?? null,
    filter.topic3 ?? null,
  ];
  while (topics.length > 0 && topics[topics.length - 1] === null) {
    topics.pop();
  }

  const request: QueryLogsRequest = {
    fromBlock: numberToHex(filterInterval[0]),
    toBlock: numberToHex(filterInterval[1]),
    order: "asc",
    filter: {
      address: filter.address as Address | Address[] | undefined,
      topics: topics.length > 0 ? topics : undefined,
    },
    fields: {
      logs: true,
      blocks: true,
      transactions: true,
    },
    limit: "0x2710",
  };

  const response = await paginate(eth_queryLogs, rpc, request, context);
  const result = mapQueryResponseData(response.data);

  if (result.blocks.length > 0) {
    await promiseAllSettledWithThrow([
      syncStore.insertBlocks({ blocks: result.blocks, chainId }),
      syncStore.insertTransactions({
        transactions: result.transactions,
        chainId,
      }),
      syncStore.insertTransactionReceipts({
        transactionReceipts: result.transactionReceipts,
        chainId,
      }),
    ]);
  }

  return result.logs;
}

async function syncTracesViaQueryApi(
  rpc: Rpc,
  filter: InternalTraceFilter | InternalTransferFilter,
  filterInterval: Interval,
  chainId: number,
  syncStore: Parameters<HistoricalSync["syncBlockRangeData"]>[0]["syncStore"],
  context?: Parameters<Rpc["request"]>[1],
) {
  const queryFilter: QueryTracesRequest["filter"] = {};

  if (filter.type === "trace") {
    const f = filter as InternalTraceFilter;
    if (f.fromAddress !== undefined) queryFilter.from = f.fromAddress as Hex;
    if (f.toAddress !== undefined) queryFilter.to = f.toAddress as Hex;
    if (f.functionSelector !== undefined)
      queryFilter.selector = f.functionSelector;
  } else {
    const f = filter as InternalTransferFilter;
    if (f.fromAddress !== undefined) queryFilter.from = f.fromAddress as Hex;
    if (f.toAddress !== undefined) queryFilter.to = f.toAddress as Hex;
  }

  const request: QueryTracesRequest = {
    fromBlock: numberToHex(filterInterval[0]),
    toBlock: numberToHex(filterInterval[1]),
    order: "asc",
    filter: queryFilter,
    fields: {
      traces: true,
      blocks: true,
      transactions: true,
    },
    limit: "0x2710",
  };

  const response = await paginate(eth_queryTraces, rpc, request, context);
  const result = mapQueryResponseData(response.data);

  if (result.traces.length > 0) {
    const blocksByNumber = new Map<Hex, SyncBlock>();
    for (const block of result.blocks) {
      blocksByNumber.set(block.number, block);
    }
    const txsByHash = new Map<Hash, SyncTransaction>();
    for (const tx of result.transactions) {
      txsByHash.set(tx.hash, tx);
    }

    await promiseAllSettledWithThrow([
      syncStore.insertBlocks({ blocks: result.blocks, chainId }),
      syncStore.insertTransactions({
        transactions: result.transactions,
        chainId,
      }),
      syncStore.insertTransactionReceipts({
        transactionReceipts: result.transactionReceipts,
        chainId,
      }),
      syncStore.insertTraces({
        traces: result.traces.map((trace) => {
          const tx = txsByHash.get(trace.transactionHash)!;
          const block = blocksByNumber.get(tx.blockNumber)!;
          return { trace, block, transaction: tx };
        }),
        chainId,
      }),
    ]);
  }
}

/**
 * Create a HistoricalSync that uses the query API (eth_queryLogs, etc.)
 * instead of the standard eth_getLogs + per-block eth_getBlockByNumber calls.
 *
 * Returns the same HistoricalSync interface as createHistoricalSync, so the
 * caller in runtime/historical.ts can pick either one based on chain.hasQueryApi.
 */
export const createQueryHistoricalSync = (
  args: CreateQueryHistoricalSyncParameters,
): HistoricalSync => {
  return {
    async syncBlockRangeData({
      interval,
      requiredIntervals,
      requiredFactoryIntervals: _requiredFactoryIntervals,
      syncStore,
    }) {
      const context = {
        logger: args.common.logger.child({ action: "fetch_block_data" }),
      };
      const endClock = startClock();

      // TODO: handle factory address discovery via query API

      let logs: SyncLog[] = [];

      const logResults = await Promise.all(
        requiredIntervals
          .filter(({ filter }) => filter.type === "log")
          .map(({ filter, interval: filterInterval }) =>
            syncLogsForFilter(
              args.rpc,
              filter as InternalLogFilter,
              filterInterval,
              args.chain.id,
              syncStore,
              context,
            ),
          ),
      );
      for (const result of logResults) {
        for (const log of result) logs.push(log);
      }

      logs = dedupe(logs, (log) => `${log.blockNumber}_${log.logIndex}`);

      // Trace and transfer filters — both use eth_queryTraces
      await Promise.all(
        requiredIntervals
          .filter(
            ({ filter }) =>
              filter.type === "trace" || filter.type === "transfer",
          )
          .map(({ filter, interval: filterInterval }) =>
            syncTracesViaQueryApi(
              args.rpc,
              filter as InternalTraceFilter | InternalTransferFilter,
              filterInterval,
              args.chain.id,
              syncStore,
              context,
            ),
          ),
      );

      args.common.logger.debug(
        {
          msg: "Fetched block range data (query API)",
          chain: args.chain.name,
          chain_id: args.chain.id,
          block_range: JSON.stringify(interval),
          log_count: logs.length,
          duration: endClock(),
        },
        ["chain", "block_range"],
      );

      return logs;
    },

    async syncBlockData({ syncStore, interval, requiredIntervals, logs }) {
      const endClock = startClock();

      // Group logs by block number
      const perBlockLogs = new Map<number, SyncLog[]>();
      for (const log of logs) {
        const blockNumber = hexToNumber(log.blockNumber);
        if (!perBlockLogs.has(blockNumber)) {
          perBlockLogs.set(blockNumber, []);
        }
        perBlockLogs.get(blockNumber)!.push(log);
      }

      let closestToTipBlock: SyncBlock | undefined;

      const syncBlockData = async (blockNumber: number) => {
        const blockLogs = perBlockLogs.get(blockNumber);
        if (!blockLogs || blockLogs.length === 0) return;

        // Track the highest block for the caller
        const blockNumberHex = numberToHex(blockNumber);
        if (
          closestToTipBlock === undefined ||
          blockNumber > hexToNumber(closestToTipBlock.number)
        ) {
          // We don't have the full SyncBlock in memory (it was inserted
          // in syncBlockRangeData), so build a minimal placeholder.
          closestToTipBlock = {
            number: blockNumberHex,
            hash: blockLogs[0]!.blockHash,
          } as SyncBlock;
        }

        // Insert the logs for this block. Blocks, transactions, and
        // receipts were already inserted by syncBlockRangeData.
        await syncStore.insertLogs({
          logs: blockLogs,
          chainId: args.chain.id,
        });
      };

      const MAX_BLOCKS_IN_MEM = Math.max(
        args.chain.finalityBlockCount * 2,
        100,
      );

      if (requiredIntervals.length > 0) {
        const queue = createQueue({
          browser: false,
          initialStart: true,
          concurrency: MAX_BLOCKS_IN_MEM,
          worker: syncBlockData,
        });

        await Promise.all(
          intervalRange(interval).map((blockNumber) => queue.add(blockNumber)),
        );
      }

      args.common.logger.debug(
        {
          msg: "Fetched block data (query API)",
          chain: args.chain.name,
          chain_id: args.chain.id,
          block_range: JSON.stringify(interval),
          duration: endClock(),
        },
        ["chain", "block_range"],
      );

      return closestToTipBlock;
    },
  };
};

/**
 * Fetch logs (with joined blocks and transactions) via the query API.
 * Standalone function for use outside the HistoricalSync interface (e.g. tests).
 *
 * Throws on failure.
 */
export async function syncLogsViaQueryApi(
  rpc: Rpc,
  params: {
    address: Address | Address[] | undefined;
    topic0?: LogTopic;
    topic1?: LogTopic;
    topic2?: LogTopic;
    topic3?: LogTopic;
    interval: Interval;
  },
  context?: Parameters<Rpc["request"]>[1],
): Promise<{
  logs: SyncLog[];
  blocks: SyncBlock[];
  transactions: SyncTransaction[];
}> {
  const topics: (LogTopic | null)[] = [
    params.topic0 ?? null,
    params.topic1 ?? null,
    params.topic2 ?? null,
    params.topic3 ?? null,
  ];
  while (topics.length > 0 && topics[topics.length - 1] === null) {
    topics.pop();
  }

  const request: QueryLogsRequest = {
    fromBlock: numberToHex(params.interval[0]),
    toBlock: numberToHex(params.interval[1]),
    order: "asc",
    filter: {
      address: params.address,
      topics: topics.length > 0 ? topics : undefined,
    },
    fields: {
      logs: true,
      blocks: true,
      transactions: true,
    },
    limit: "0x2710",
  };

  const response = await paginate(eth_queryLogs, rpc, request, context);
  return mapQueryResponseData(response.data);
}
