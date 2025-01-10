import type { Trace } from "@/utils/debug.js";
import type {
  BlockTag,
  Hex,
  Log,
  RpcBlock,
  RpcTransaction,
  RpcTransactionReceipt,
} from "viem";

export type SyncBlock = RpcBlock<Exclude<BlockTag, "pending">, true>;
export type LightSyncBlock = Pick<
  SyncBlock,
  "hash" | "number" | "timestamp" | "transactions"
>;
export type LightSyncTrace = {
  trace: Pick<Trace["result"], "from" | "to" | "type" | "input" | "value"> & {
    index: number;
  };
  transactionHash: Trace["txHash"];
};
export type SyncLog = Log<Hex, Hex, false>;
export type SyncTransaction = RpcTransaction<false>;
export type SyncTransactionReceipt = RpcTransactionReceipt;
export type SyncTrace = {
  trace: Trace["result"] & { index: number; subcalls: number };
  transactionHash: Trace["txHash"];
};

export type LightBlock = Pick<
  SyncBlock,
  "hash" | "parentHash" | "number" | "timestamp"
>;
