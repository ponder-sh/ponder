import { Generated, Insertable } from "kysely";
import { Block, Log, TransactionBase } from "viem";
import { Prettify, RequiredBy } from "./utils";

type BlocksTable = Prettify<
  RequiredBy<
    Omit<Block, "transactions" | "uncles" | "sealFields">,
    "hash" | "logsBloom" | "nonce" | "number" | "totalDifficulty"
  > & { chainId: number }
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
  } & { chainId: number }
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
  }
>;

export type InsertableLog = Insertable<LogsTable>;

interface ContractCallsTable {
  key: string;
  result: string;
  chainId: number;
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
