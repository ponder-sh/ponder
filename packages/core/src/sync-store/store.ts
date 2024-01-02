import type { FactoryCriteria, LogFilterCriteria } from "@/config/sources.js";
import type { Block } from "@/types/block.js";
import type { Log } from "@/types/log.js";
import type { Transaction } from "@/types/transaction.js";
import type { Checkpoint } from "@/utils/checkpoint.js";
import type { Kysely, Migrator } from "kysely";
import type { Address, Hex, RpcBlock, RpcLog, RpcTransaction } from "viem";

export interface SyncStore {
  kind: "sqlite" | "postgres";
  db: Kysely<any>;
  migrator: Migrator;

  migrateUp(): Promise<void>;

  kill(): Promise<void>;

  /**
   * Insert a list of logs & associated transactions matching a given log filter
   * within a specific block. Also insert the log interval recording the eth_getLogs
   * request that was made and returned this result.
   *
   * Note that `block.number` should always be equal to `interval.endBlock`.
   */
  insertLogFilterInterval(options: {
    chainId: number;
    logFilter: LogFilterCriteria;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
    interval: { startBlock: bigint; endBlock: bigint };
  }): Promise<void>;

  /**
   * Get all block intervals where logs (and associated blocks & transactions)
   * matching the specified log filter have already been inserted.
   */
  getLogFilterIntervals(options: {
    chainId: number;
    logFilter: LogFilterCriteria;
  }): Promise<[number, number][]>;

  /**
   * Insert a list of logs containing factory child addresses.
   *
   * Note that the log filter interval for these logs gets inserted
   * in a separate call to `insertLogFilterInterval`. The purpose of this
   * method is to make the logs available to `getFactoryChildAddresses`
   * without requiring that the associated block & transaction have been inserted.
   */
  insertFactoryChildAddressLogs(options: {
    chainId: number;
    logs: RpcLog[];
  }): Promise<void>;

  /**
   * Get all child contract addresses that have been created by
   * the specified factory up to the specified block number.
   *
   * Returns an async generator with a default page size of 500.
   */
  getFactoryChildAddresses(options: {
    chainId: number;
    factory: FactoryCriteria;
    upToBlockNumber: bigint;
    pageSize?: number;
  }): AsyncGenerator<Address[]>;

  /**
   * Insert a list of logs & associated transactions produced by all child
   * contracts of the specified factory within a specific block. Also insert the log
   * interval recording the eth_getLogs request that was made and returned this result.
   *
   * Note that `block.number` should always be equal to `interval.endBlock`.
   */
  insertFactoryLogFilterInterval(options: {
    chainId: number;
    factory: FactoryCriteria;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
    interval: { startBlock: bigint; endBlock: bigint };
  }): Promise<void>;

  /**
   * Get all block intervals where logs (and associated blocks & transactions)
   * produced by all child contracts of the specified factory contract have already
   * been inserted.
   */
  getFactoryLogFilterIntervals(options: {
    chainId: number;
    factory: FactoryCriteria;
  }): Promise<[number, number][]>;

  /**
   * Inserts a new realtime block and any logs/transactions that match the
   * registered sources. Does NOT insert intervals to mark this data as finalized,
   * see insertRealtimeInterval for that.
   */
  insertRealtimeBlock(options: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
  }): Promise<void>;

  /**
   * Marks data as finalized by inserting cache intervals for all registered sources
   * in real time.
   */
  insertRealtimeInterval(options: {
    chainId: number;
    logFilters: LogFilterCriteria[];
    factories: FactoryCriteria[];
    interval: { startBlock: bigint; endBlock: bigint };
  }): Promise<void>;

  /**
   * Deletes ALL data from the store with a block number GREATER than the
   * specified block number. Any data at fromBlock is not deleted.
   *
   * This includes block/transaction/logs, child contracts, and intervals.
   */
  deleteRealtimeData(options: {
    chainId: number;
    fromBlock: bigint;
  }): Promise<void>;

  /** RPC REQUEST METHODS */

  insertRpcRequestResult(options: {
    request: string;
    blockNumber: bigint;
    chainId: number;
    result: string;
  }): Promise<void>;

  getRpcRequestResult(options: {
    request: string;
    blockNumber: bigint;
    chainId: number;
  }): Promise<{
    request: string;
    blockNumber: bigint;
    chainId: number;
    result: string;
  } | null>;

  /** EVENTS METHOD */

  getLogEvents(arg: {
    fromCheckpoint: Checkpoint;
    toCheckpoint: Checkpoint;
    logFilters?: {
      id: string;
      chainId: number;
      criteria: LogFilterCriteria;
      fromBlock?: number;
      toBlock?: number;
      includeEventSelectors?: Hex[];
    }[];
    factories?: {
      id: string; // Note that this is the source ID of the child contract.
      chainId: number;
      criteria: FactoryCriteria;
      fromBlock?: number;
      toBlock?: number;
      includeEventSelectors?: Hex[];
    }[];
    pageSize?: number;
  }): AsyncGenerator<{
    events: {
      sourceId: string;
      chainId: number;
      log: Log;
      block: Block;
      transaction: Transaction;
    }[];
    metadata: {
      counts: {
        sourceId: string;
        selector: Hex;
        count: number;
      }[];
      pageEndCheckpoint: Checkpoint;
    };
  }>;
}
