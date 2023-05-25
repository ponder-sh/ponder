import { Kysely } from "kysely";
import { Address, Hex, RpcBlock, RpcLog, RpcTransaction } from "viem";

import type { Block, Log, LogFilterCachedRange, Transaction } from "./types";

export interface EventStore {
  db: Kysely<any>;

  migrateUp(): Promise<void>;
  migrateDown(): Promise<void>;

  getLogEvents(arg: {
    fromTimestamp: number;
    toTimestamp: number;
    filters: {
      chainId: number;
      address?: Address | Address[];
      topics?: (Hex | Hex[] | null)[];
    }[];
  }): Promise<{ log: Log; block: Block; transaction: Transaction }[]>;

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

  insertFinalizedLogs(options: {
    chainId: number;
    logs: RpcLog[];
  }): Promise<void>;

  insertFinalizedBlock(options: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logFilterRange: {
      blockNumberToCacheFrom: number;
      logFilterKey: string;
    };
  }): Promise<void>;

  // // Injected contract call methods.
  // upsertContractCall(contractCall: ContractCall): Promise<void>;
  // getContractCall(contractCallKey: string): Promise<ContractCall | null>;
}
