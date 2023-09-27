import type { Kysely, Migrator } from "kysely";
import type { Address, Hex, RpcBlock, RpcLog, RpcTransaction } from "viem";

import type { Block } from "@/types/block";
import type { Log } from "@/types/log";
import type { Transaction } from "@/types/transaction";

/**
 * A record representing a range of blocks that have been added
 * to the event store for a given log filter.
 */
export type LogFilterCachedRange = {
  filterKey: string;
  startBlock: number;
  endBlock: number;
  endBlockTimestamp: number;
};

/**
 * A record representing a call to a contract made at a specific block height.
 */
export type ContractReadResult = {
  address: string;
  blockNumber: bigint;
  chainId: number;
  data: Hex;
  result: Hex;
};

export interface EventStore {
  kind: "sqlite" | "postgres";
  db: Kysely<any>;
  migrator: Migrator;

  migrateUp(): Promise<void>;
  migrateDown(): Promise<void>;

  getFactoryIntervals(options: {
    chainId: number;
    factoryAddress: Hex;
    factoryEventSelector: Hex;
  }): Promise<{
    factoryContractIntervals: [number, number][];
    childContractIntervals: [number, number][];
  }>;

  insertHistoricalLogFilterResult(options: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
    logFilter: {
      address?: Hex | Hex[];
      topics?: (Hex | Hex[] | null)[];
      startBlock: bigint;
      endBlock: bigint;
      endBlockTimestamp: bigint;
    };
  }): Promise<void>;

  getLogFilterIntervals(options: {
    chainId: number;
    address?: Hex | Hex[];
    topics?: (Hex | Hex[] | null)[];
  }): Promise<[number, number][]>;

  insertRealtimeBlock(options: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
  }): Promise<void>;

  deleteRealtimeData(options: {
    chainId: number;
    fromBlockNumber: number;
  }): Promise<void>;

  insertContractReadResult(options: {
    address: string;
    blockNumber: bigint;
    chainId: number;
    data: Hex;
    result: Hex;
  }): Promise<void>;

  getContractReadResult(options: {
    address: string;
    blockNumber: bigint;
    chainId: number;
    data: Hex;
  }): Promise<ContractReadResult | null>;

  getLogEvents(arg: {
    fromTimestamp: number;
    toTimestamp: number;
    filters?: {
      name: string;
      chainId: number;
      address?: Address | Address[];
      topics?: (Hex | Hex[] | null)[];
      fromBlock?: number;
      toBlock?: number;
      includeEventSelectors?: Hex[];
    }[];
    pageSize?: number;
  }): AsyncGenerator<{
    events: {
      logFilterName: string;
      log: Log;
      block: Block;
      transaction: Transaction;
    }[];
    metadata: {
      pageEndsAtTimestamp: number;
      counts: {
        logFilterName: string;
        selector: Hex;
        count: number;
      }[];
    };
  }>;
}
