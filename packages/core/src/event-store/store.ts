import type { Kysely, Migrator } from "kysely";
import type { Address, Hex, RpcBlock, RpcLog, RpcTransaction } from "viem";

import { FactoryCriteria } from "@/config/factories";
import { LogFilterCriteria } from "@/config/logFilters";
import type { Block } from "@/types/block";
import type { Log } from "@/types/log";
import type { Transaction } from "@/types/transaction";

export interface EventStore {
  kind: "sqlite" | "postgres";
  db: Kysely<any>;
  migrator: Migrator;

  migrateUp(): Promise<void>;

  kill(): Promise<void>;

  /** LOG FILTER METHODS */

  insertHistoricalLogFilterInterval(options: {
    chainId: number;
    logFilter: LogFilterCriteria;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
    interval: {
      startBlock: bigint;
      endBlock: bigint;
    };
  }): Promise<void>;

  getLogFilterIntervals(options: {
    chainId: number;
    logFilter: LogFilterCriteria;
  }): Promise<[number, number][]>;

  /** FACTORY & CHILD CONTRACT METHODS */

  /**
   * Insert a list of child contract addresses and creation block numbers
   * for the specified factory.
   */
  insertHistoricalFactoryInterval(options: {
    chainId: number;
    factory: FactoryCriteria;
    newChildContracts: {
      address: Address;
      creationBlock: bigint;
    }[];
    interval: {
      startBlock: bigint;
      endBlock: bigint;
    };
  }): Promise<void>;

  /**
   * Get all block intervals where child contract addresses and creation
   * block numbers for the specified factory have already been inserted.
   */
  getFactoryIntervals(options: {
    chainId: number;
    factory: FactoryCriteria;
  }): Promise<[number, number][]>;

  /**
   * Get all child contract addresses that have been created by
   * the specified factory up to the specified block number.
   *
   * Returns an async generator with a default page size of 10_000.
   */
  getChildContractAddresses(options: {
    chainId: number;
    factory: FactoryCriteria;
    upToBlockNumber: bigint;
    pageSize?: number;
  }): AsyncGenerator<Address[]>;

  /**
   * Insert a list of logs (and associated blocks & transactions) produced by
   * all child contracts of the specified factory within the specified
   * block range.
   */
  insertHistoricalChildContractInterval(options: {
    chainId: number;
    factory: FactoryCriteria;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
    interval: {
      startBlock: bigint;
      endBlock: bigint;
    };
  }): Promise<void>;

  /**
   * Get all block intervals where logs (and associated blocks & transactions)
   * produced by all child contracts of the specified factory contract have already
   * been inserted.
   */
  getChildContractIntervals(options: {
    chainId: number;
    factory: FactoryCriteria;
  }): Promise<[number, number][]>;

  /** BLAH */

  /**
   * Inserts new child contracts that are found in real-time.
   */
  insertRealtimeChildContracts(options: {
    chainId: number;
    factory: FactoryCriteria;
    newChildContracts: {
      address: Address;
      creationBlock: bigint;
    }[];
  }): Promise<void>;

  /**
   * Inserts a new realtime block and any logs/transactions that match the
   * event sources. Does NOT insert intervals to mark this data as finalized,
   * see insertRealtimeInterval for that.
   */
  insertRealtimeBlock(options: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
  }): Promise<void>;

  /**
   * Marks data as finalized by inserting cache intervals for all event sources
   * in real time.
   */
  insertRealtimeInterval(options: {
    chainId: number;
    logFilters: LogFilterCriteria[];
    factories: FactoryCriteria[];
    interval: {
      startBlock: bigint;
      endBlock: bigint;
    };
  }): Promise<void>;

  /**
   * Deletes ALL data from the store with a block number greater than the
   * specified block number.
   *
   * This includes block/transaction/logs, child contracts, and intervals.
   */
  deleteRealtimeData(options: {
    chainId: number;
    fromBlockNumber: bigint;
  }): Promise<void>;

  /** CONTRACT READ METHODS */

  insertContractReadResult(options: {
    address: Address;
    blockNumber: bigint;
    chainId: number;
    data: Hex;
    result: Hex;
  }): Promise<void>;

  getContractReadResult(options: {
    address: Address;
    blockNumber: bigint;
    chainId: number;
    data: Hex;
  }): Promise<{
    address: Address;
    blockNumber: bigint;
    chainId: number;
    data: Hex;
    result: Hex;
  } | null>;

  /** EVENTS METHOD */

  getLogEvents(arg: {
    fromTimestamp: number;
    toTimestamp: number;
    logFilters?: {
      name: string;
      chainId: number;
      criteria: LogFilterCriteria;
      fromBlock?: number;
      toBlock?: number;
      includeEventSelectors?: Hex[];
    }[];
    factories?: {
      name: string; // Note that this is the name of the child contract.
      chainId: number;
      criteria: FactoryCriteria;
      fromBlock?: number;
      toBlock?: number;
      includeEventSelectors?: Hex[];
    }[];
    pageSize?: number;
  }): AsyncGenerator<{
    events: {
      eventSourceName: string;
      log: Log;
      block: Block;
      transaction: Transaction;
    }[];
    metadata: {
      pageEndsAtTimestamp: number;
      counts: {
        eventSourceName: string;
        selector: Hex;
        count: number;
      }[];
    };
  }>;
}
