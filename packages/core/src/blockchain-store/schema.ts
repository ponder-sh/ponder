import { Generated, Insertable } from "kysely";
import { Block, Log, TransactionBase } from "viem";

import { Prettify, RequiredBy } from "@/types/utils";

type BlocksTable = Prettify<
  RequiredBy<
    Omit<Block, "transactions" | "uncles" | "sealFields">,
    "hash" | "logsBloom" | "nonce" | "number" | "totalDifficulty"
  > & {
    chainId: number;
    finalized: number; // Boolean (0 or 1).
  }
>;

export type InsertableBlock = Insertable<BlocksTable>;

type TransactionsTable = Prettify<
  RequiredBy<
    TransactionBase,
    "blockHash" | "blockNumber" | "transactionIndex"
  > & {
    gasPrice: bigint | null;
    maxFeePerGas: bigint | null;
    maxPriorityFeePerGas: bigint | null;
    accessList: string | null; // Stringified JSON
    type: "legacy" | "eip2930" | "eip1559";
  } & {
    chainId: number;
    finalized: number; // Boolean (0 or 1).
  }
>;

export type InsertableTransaction = Insertable<TransactionsTable>;

type LogsTable = Prettify<
  RequiredBy<
    Omit<
      Log,
      "topics" | "removed" // Don't persist `removed`; just set it to false before returning from the store.
    >,
    | "blockHash"
    | "blockNumber"
    | "transactionIndex"
    | "transactionHash"
    | "logIndex"
  > & {
    id: string;
    blockTimestamp: bigint | null;
    topic0: string | null;
    topic1: string | null;
    topic2: string | null;
    topic3: string | null;
  } & {
    chainId: number;
    finalized: number; // Boolean (0 or 1).
  }
>;

export type InsertableLog = Insertable<LogsTable>;

interface ContractCallsTable {
  address: string;
  blockNumber: bigint;
  chainId: number;
  data: string;
  finalized: number; // Boolean (0 or 1).
  id: string; // Primary key from `${chainId}-${blockNumber}-${address}-${data}`
  result: string;
}

interface LogFilterCachedRangesTable {
  id: Generated<number>;
  filterKey: string;
  startBlock: number;
  endBlock: number;
  endBlockTimestamp: number;
}

export interface Database {
  blocks: BlocksTable;
  transactions: TransactionsTable;
  logs: LogsTable;
  contractCalls: ContractCallsTable;
  logFilterCachedRanges: LogFilterCachedRangesTable;
}
