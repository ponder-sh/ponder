import type { Kysely } from "kysely";
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
  startBlock: bigint;
  endBlock: bigint;
  endBlockTimestamp: bigint;
};

/**
 * A record representing a call to a contract made at a specific block height.
 */
export type ContractReadResult = {
  address: string;
  blockNumber: bigint;
  chainId: number;
  data: Hex;
  finalized: boolean;
  result: Hex;
};

export interface EventStore {
  db: Kysely<any>;

  migrateUp(): Promise<void>;
  migrateDown(): Promise<void>;

  insertFinalizedLogs(options: {
    chainId: number;
    logs: RpcLog[];
  }): Promise<void>;

  insertFinalizedBlock(options: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logFilterRange: {
      logFilterKey: string;
      blockNumberToCacheFrom: number;
      logFilterStartBlockNumber: number;
    };
  }): Promise<{ startingRangeEndTimestamp: number }>;

  insertUnfinalizedBlock(options: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
  }): Promise<void>;

  deleteUnfinalizedData(options: {
    chainId: number;
    fromBlockNumber: number;
  }): Promise<void>;

  finalizeData(options: {
    chainId: number;
    toBlockNumber: number;
  }): Promise<void>;

  getLogFilterCachedRanges(options: {
    filterKey: string;
  }): Promise<LogFilterCachedRange[]>;

  insertContractReadResult(options: {
    address: string;
    blockNumber: bigint;
    chainId: number;
    data: Hex;
    finalized: boolean;
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
      handledTopic0?: Hex[];
    }[];
  }): Promise<{
    totalEventCount: number;
    events: {
      filterName: string;
      log: Log;
      block: Block;
      transaction: Transaction;
    }[];
  }>;
}
