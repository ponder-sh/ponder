import type Sqlite from "better-sqlite3";

import { SqliteCacheStore } from "./sqliteCacheStore";
import { CachedBlock, CachedLog, CachedTransaction } from "./utils";

export type ContractMetadata = {
  contractAddress: string;
  startBlock: number;
  endBlock: number;
};

export type ContractCall = {
  key: string; // `${chainId}-${blockNumber}-${contractAddress}-${data}`
  result: string; // Stringified JSON of the contract call result
};

export interface BaseCacheStore {
  db: Sqlite.Database;

  migrate(): Promise<void>;

  getContractMetadata(
    contractAddress: string
  ): Promise<ContractMetadata | null>;

  upsertContractMetadata(
    attributes: ContractMetadata
  ): Promise<ContractMetadata>;

  insertLogs(log: CachedLog[]): Promise<void>;

  insertBlock(block: CachedBlock): Promise<void>;

  insertTransactions(transactions: CachedTransaction[]): Promise<void>;

  getLogs(addresses: string[], fromBlock: number): Promise<CachedLog[]>;

  getBlock(hash: string): Promise<CachedBlock | null>;

  getTransaction(hash: string): Promise<CachedTransaction | null>;

  upsertContractCall(contractCall: ContractCall): Promise<void>;

  getContractCall(contractCallKey: string): Promise<ContractCall | null>;
}

export type CacheStore = SqliteCacheStore;
