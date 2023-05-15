import { Address, Hex, RpcBlock, RpcLog, RpcTransaction } from "viem";

import type { Block, Log, Transaction } from "@/common/types";

// import { PonderDatabase } from "../db";
// import { PostgresCacheStore } from "./postgresCacheStore";
// import { SqliteCacheStore } from "./sqliteCacheStore";

export type LogFilterCachedRange = {
  filterKey: string; // `${chainId}-${address}-${topics}`
  startBlock: number;
  endBlock: number;
  endBlockTimestamp: number;
};

export type ContractCall = {
  key: string; // `${chainId}-${blockNumber}-${address}-${data}`
  result: string; // Stringified JSON of the contract call result
};

export interface BlockchainStore {
  migrate(): Promise<void>;

  // Event source service method.
  getLogs(arg: {
    fromBlockTimestamp: number;
    toBlockTimestamp: number;
    chainId: number;
    address?: Address | Address[];
    topics?: (Hex | Hex[] | null)[];
  }): Promise<Log[]>;

  // Unfinalized sync methods.
  insertUnfinalizedBlock({
    block,
    transactions,
    logs,
  }: {
    block: RpcBlock;
    transactions: RpcTransaction;
    logs: RpcLog[];
  }): Promise<void>;
  deleteUnfinalizedData({
    fromBlockNumber,
  }: {
    fromBlockNumber: number;
  }): Promise<void>;
  finalizeData({ toBlockNumber }: { toBlockNumber: number }): Promise<void>;

  // Finalized sync methods.
  getLogFilterCachedRanges(arg: {
    filterKey: string;
  }): Promise<LogFilterCachedRange[]>;
  insertLogFilterCachedRange(arg: {
    range: LogFilterCachedRange;
  }): Promise<void>;
  insertFinalizedLogs({ logs }: { logs: RpcLog[] }): Promise<void>;
  insertFinalizedBlock({
    block,
    transactions,
  }: {
    block: RpcBlock;
    transactions: RpcTransaction;
  }): Promise<void>;

  // Injected contract call methods.
  upsertContractCall(contractCall: ContractCall): Promise<void>;
  getContractCall(contractCallKey: string): Promise<ContractCall | null>;
}

// export const buildCacheStore = ({ database }: { database: PonderDatabase }) => {
//   switch (database.kind) {
//     case "sqlite": {
//       return new SqliteCacheStore({ db: database.db });
//     }
//     case "postgres": {
//       return new PostgresCacheStore({ pool: database.pool });
//     }
//   }
// };
