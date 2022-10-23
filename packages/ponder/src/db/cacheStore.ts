import type { Block, EventLog, Transaction } from "@/common/types";

import { PonderDatabase } from "./db";
import { SqliteCacheStore } from "./sqliteCacheStore";

export type CachedInterval = {
  contractAddress: string;
  startBlock: number;
  endBlock: number;
};

export type ContractCall = {
  key: string; // `${chainId}-${blockNumber}-${contractAddress}-${data}`
  result: string; // Stringified JSON of the contract call result
};

export interface CacheStore {
  migrate(): Promise<void>;

  getCachedIntervals(contractAddress: string): Promise<CachedInterval[]>;

  insertCachedInterval(interval: CachedInterval): Promise<void>;

  insertLogs(log: EventLog[]): Promise<void>;

  insertBlock(block: Block): Promise<void>;

  insertTransactions(transactions: Transaction[]): Promise<void>;

  getLogs(addresses: string[], fromBlock: number): Promise<EventLog[]>;

  getBlock(hash: string): Promise<Block | null>;

  getTransaction(hash: string): Promise<Transaction | null>;

  upsertContractCall(contractCall: ContractCall): Promise<void>;

  getContractCall(contractCallKey: string): Promise<ContractCall | null>;
}

export const buildCacheStore = (database: PonderDatabase) => {
  switch (database.kind) {
    case "sqlite": {
      return new SqliteCacheStore(database.db);
    }
    default: {
      throw new Error(`Unsupported database kind: ${database.kind}`);
    }
  }
};
