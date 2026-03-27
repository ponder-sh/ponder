import type { Common } from "@/internal/common.js";
import type {
  Chain,
  FactoryId,
  LogFilter as InternalLogFilter,
  SyncBlock,
  SyncLog,
  SyncTransaction,
} from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import { mapQueryResponseData } from "@/rpc/query-mappers.js";
import {
  eth_queryLogs,
  paginate,
  type QueryLogsRequest,
} from "@/rpc/query.js";
import { dedupe } from "@/utils/dedupe.js";
import { type Interval, intervalRange } from "@/utils/interval.js";
import { promiseAllSettledWithThrow } from "@/utils/promiseAllSettledWithThrow.js";
import { createQueue } from "@/utils/queue.js";
import { startClock } from "@/utils/timer.js";
import {
  type Address,
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

      // Build one query per unique (address, topics) combination
      const logFilters = requiredIntervals
        .filter(({ filter }) => filter.type === "log")
        .map(({ filter, interval: filterInterval }) => ({
          filter: filter as InternalLogFilter,
          interval: filterInterval,
        }));

      let logs: SyncLog[] = [];

      await Promise.all(
        logFilters.map(async ({ filter, interval: filterInterval }) => {
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

          const response = await paginate(
            eth_queryLogs,
            args.rpc,
            request,
            context,
          );
          const result = mapQueryResponseData(response.data);

          for (const log of result.logs) logs.push(log);

          // The query API returns blocks, transactions, and receipts
          // (receipt fields are embedded on the transaction response)
          // all in one call. Insert everything now.
          if (result.blocks.length > 0) {
            await promiseAllSettledWithThrow([
              syncStore.insertBlocks({
                blocks: result.blocks,
                chainId: args.chain.id,
              }),
              syncStore.insertTransactions({
                transactions: result.transactions,
                chainId: args.chain.id,
              }),
              syncStore.insertTransactionReceipts({
                transactionReceipts: result.transactionReceipts,
                chainId: args.chain.id,
              }),
            ]);
          }
        }),
      );

      logs = dedupe(logs, (log) => `${log.blockNumber}_${log.logIndex}`);

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
          intervalRange(interval).map((blockNumber) =>
            queue.add(blockNumber),
          ),
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
