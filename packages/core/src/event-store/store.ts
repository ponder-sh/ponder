import type { Kysely, Migrator } from "kysely";
import type { Address, Hex, RpcBlock, RpcLog, RpcTransaction } from "viem";

import type { Block } from "@/types/block";
import type { Log } from "@/types/log";
import type { Transaction } from "@/types/transaction";

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

  /** LOG FILTER METHODS */

  insertLogFilterInterval(options: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
    logFilter: {
      address?: Hex | Hex[];
      topics?: (Hex | Hex[] | null)[];
    };
    interval: {
      startBlock: bigint;
      endBlock: bigint;
      endBlockTimestamp: bigint;
    };
  }): Promise<void>;

  getLogFilterIntervals(options: {
    chainId: number;
    logFilter: {
      address?: Hex | Hex[];
      topics?: (Hex | Hex[] | null)[];
    };
  }): Promise<[number, number][]>;

  /** FACTORY & CHILD CONTRACT METHODS */

  /**
   * Insert a list of child contract addresses and creation block numbers
   * for the specified factory contract.
   */
  insertFactoryContractInterval(options: {
    chainId: number;
    childContracts: {
      address: Hex;
      creationBlock: bigint;
    }[];
    factoryContract: {
      address: Hex;
      eventSelector: Hex;
    };
    interval: {
      startBlock: bigint;
      endBlock: bigint;
    };
  }): Promise<void>;

  /**
   * Get all block intervals where child contract addresses and creation
   * block numbers of the specified factory contract have already been inserted.
   */
  getFactoryContractIntervals(options: {
    chainId: number;
    factoryContract: {
      address: Hex;
      eventSelector: Hex;
    };
  }): Promise<[number, number][]>;

  /**
   * Get all child contract addresses that have been created by
   * the specified factory contract up to the specified block number.
   *
   * Returns an async generator with a default page size of 10_000.
   */
  getChildContractAddresses(options: {
    chainId: number;
    upToBlockNumber: bigint;
    factoryContract: {
      address: Hex;
      eventSelector: Hex;
    };
    pageSize?: number;
  }): AsyncGenerator<Hex[]>;

  /**
   * Insert a list of logs (and associated blocks & transactions) produced by
   * all child contracts of the specified factory contract within the specified
   * block range.
   */
  insertChildContractInterval(options: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
    factoryContract: {
      address: Hex;
      eventSelector: Hex;
    };
    interval: {
      startBlock: bigint;
      endBlock: bigint;
      endBlockTimestamp: bigint;
    };
  }): Promise<void>;

  /**
   * Get all block intervals where logs (and associated blocks & transactions)
   * produced by all child contracts of the specified factory contract have already
   * been inserted.
   */
  getChildContractIntervals(options: {
    chainId: number;
    factoryContract: {
      address: Hex;
      eventSelector: Hex;
    };
  }): Promise<[number, number][]>;

  /** BLAH */

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

  /** CONTRACT READ METHODS */

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

  /** EVENTS METHOD */

  getLogEvents(arg: {
    fromTimestamp: number;
    toTimestamp: number;
    logFilters?: {
      name: string;
      chainId: number;
      address?: Address | Address[];
      topics?: (Hex | Hex[] | null)[];
      fromBlock?: number;
      toBlock?: number;
      includeEventSelectors?: Hex[];
    }[];
    factoryContracts?: {
      chainId: number;
      address: string;
      factoryEventSelector: Hex;
      child: {
        name: string;
        includeEventSelectors?: Hex[];
      };
      fromBlock?: number;
      toBlock?: number;
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
