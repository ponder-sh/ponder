import type { Address } from "viem";
import type { Logger } from "@/internal/logger.js";
import type {
  Factory,
  Filter,
  Fragment,
  InternalBlock,
  InternalLog,
  InternalTrace,
  InternalTransaction,
  InternalTransactionReceipt,
  LightBlock,
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/internal/types.js";
import type { RequestParameters } from "@/rpc/index.js";
import type {
  IntervalWithFactory,
  IntervalWithFilter,
} from "@/runtime/index.js";
import type { Interval } from "@/utils/interval.js";

/**
 * Everything the sync engine needs from durable storage.
 *
 * This is the seam between the engine and the database. The engine is written
 * against this type alone, so an application that wants Ponder's backfill,
 * reorg handling, factory child-address discovery and rpc cache while owning
 * its own tables implements this and supplies it. `createSyncStore` in
 * `./index.ts` is the implementation Ponder itself runs, over Postgres and
 * PGlite via Drizzle.
 *
 * It is declared apart from that implementation so that depending on the
 * contract does not mean depending on Drizzle.
 */
export type SyncStore = {
  insertIntervals(
    args: {
      intervals: IntervalWithFilter[];
      factoryIntervals: IntervalWithFactory[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  getIntervals(
    args: { filters: Filter[] },
    context?: { logger?: Logger },
  ): Promise<
    Map<Filter | Factory, { fragment: Fragment; intervals: Interval[] }[]>
  >;
  insertChildAddresses(
    args: {
      factory: Factory;
      childAddresses: Map<Address, number>;
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  getChildAddresses(
    args: { factory: Factory },
    context?: { logger?: Logger },
  ): Promise<Map<Address, number>>;
  getSafeCrashRecoveryBlock(
    args: {
      chainId: number;
      timestamp: number;
    },
    context?: { logger?: Logger },
  ): Promise<{ number: bigint; timestamp: bigint } | undefined>;
  insertLogs(
    args: { logs: SyncLog[]; chainId: number },
    context?: { logger?: Logger },
  ): Promise<void>;
  insertBlocks(
    args: {
      blocks: (SyncBlock | SyncBlockHeader)[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  insertTransactions(
    args: {
      transactions: SyncTransaction[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  insertTransactionReceipts(
    args: {
      transactionReceipts: SyncTransactionReceipt[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  insertTraces(
    args: {
      traces: {
        trace: SyncTrace;
        block: SyncBlock;
        transaction: SyncTransaction;
      }[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  getEventData(
    args: {
      filters: Filter[];
      fromBlock: number;
      toBlock: number;
      chainId: number;
      limit: number;
    },
    context?: { logger?: Logger },
  ): Promise<{
    blocks: InternalBlock[];
    logs: InternalLog[];
    transactions: InternalTransaction[];
    transactionReceipts: InternalTransactionReceipt[];
    traces: InternalTrace[];
    cursor: number;
  }>;
  insertRpcRequestResults(
    args: {
      requests: {
        request: RequestParameters;
        blockNumber: number | undefined;
        result: string;
      }[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  getRpcRequestResults(
    args: {
      requests: RequestParameters[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<(string | undefined)[]>;
  pruneRpcRequestResults(
    args: {
      blocks: Pick<LightBlock, "number">[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  pruneByChain(
    args: { chainId: number },
    context?: { logger?: Logger },
  ): Promise<void>;
};
