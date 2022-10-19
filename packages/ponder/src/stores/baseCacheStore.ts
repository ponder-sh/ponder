import type { Block, EventLog, Transaction } from "@/types";

import { PonderDatabase } from "./db";
import { SqliteCacheStore } from "./sqliteCacheStore";

export type ContractMetadata = {
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

  getContractMetadata(
    contractAddress: string
  ): Promise<ContractMetadata | null>;

  upsertContractMetadata(
    attributes: ContractMetadata
  ): Promise<ContractMetadata>;

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
