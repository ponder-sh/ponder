import type { Block, Log } from "@ethersproject/providers";
import type Sqlite from "better-sqlite3";
import type { Transaction } from "ethers";

import { SqliteCacheStore } from "./sqliteCacheStore";

export type ContractMetadata = {
  contractAddress: string;
  startBlock: number;
  endBlock: number;
};

export interface BaseCacheStore {
  db: Sqlite.Database;

  migrate(): Promise<void>;

  getContractMetadata(
    contractAddress: string
  ): Promise<ContractMetadata | null>;

  getCachedBlockRange(
    contractAddresses: string[]
  ): Promise<{ maxStartBlock: number; minEndBlock: number } | null>;

  upsertContractMetadata(
    attributes: ContractMetadata
  ): Promise<ContractMetadata>;

  upsertLog(log: Log): Promise<void>;

  insertBlock(block: Block): Promise<void>;

  insertTransactions(transactions: Transaction[]): Promise<void>;

  getLogs(addresses: string[], fromBlock: number): Promise<Log[]>;

  getBlock(blockHash: string): Promise<Block | null>;

  getTransaction(transactionHash: string): Promise<Transaction | null>;
}

export type CacheStore = SqliteCacheStore;
