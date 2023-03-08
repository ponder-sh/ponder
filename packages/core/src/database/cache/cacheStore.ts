import type { Block, Log, Transaction } from "@/common/types";

import { PonderDatabase } from "../db";
import { PostgresCacheStore } from "./postgresCacheStore";
import { SqliteCacheStore } from "./sqliteCacheStore";

export type CachedInterval = {
  contractAddress: string;
  startBlock: number;
  endBlock: number;
  endBlockTimestamp: number;
};

export type ContractCall = {
  key: string; // `${chainId}-${blockNumber}-${contractAddress}-${data}`
  result: string; // Stringified JSON of the contract call result
};

export interface CacheStore {
  migrate(): Promise<void>;

  getCachedIntervals(contractAddress: string): Promise<CachedInterval[]>;

  insertCachedInterval(interval: CachedInterval): Promise<void>;

  insertLogs(logs: Log[]): Promise<void>;

  insertBlock(block: Omit<Block, "transactions">): Promise<void>;

  insertTransactions(transactions: Transaction[]): Promise<void>;

  getLogs(
    contractAddress: string,
    fromBlockTimestamp: number,
    toBlockTimestamp: number,
    eventSigHashes?: string[]
  ): Promise<Log[]>;

  getBlock(hash: string): Promise<Omit<Block, "transactions"> | null>;

  getTransaction(hash: string): Promise<Transaction | null>;

  upsertContractCall(contractCall: ContractCall): Promise<void>;

  getContractCall(contractCallKey: string): Promise<ContractCall | null>;
}

export const buildCacheStore = ({ database }: { database: PonderDatabase }) => {
  switch (database.kind) {
    case "sqlite": {
      return new SqliteCacheStore({ db: database.db });
    }
    case "postgres": {
      return new PostgresCacheStore({ pool: database.pool });
    }
  }
};
