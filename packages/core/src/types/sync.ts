import type {
  Address,
  BlockTag,
  Hex,
  Log,
  RpcBlock,
  RpcTransaction,
  RpcTransactionReceipt,
} from "viem";

export type SyncBlock = RpcBlock<Exclude<BlockTag, "pending">, true>;
export type SyncLog = Log<Hex, Hex, false>;
export type SyncTransaction = RpcTransaction<false>;
export type SyncTransactionReceipt = RpcTransactionReceipt;
export type SyncTrace =
  | SyncCallTrace
  | SyncCreateTrace
  | SyncRewardTrace
  | SyncSuicideTrace;

export type LightBlock = Pick<
  SyncBlock,
  "hash" | "parentHash" | "number" | "timestamp"
>;

export type SyncCallTrace = {
  action: {
    callType: "call" | "delegatecall" | "staticcall";
    from: Address;
    gas: Hex;
    input: Hex;
    to: Address;
    value: Hex;
  };
  blockHash: Hex;
  blockNumber: Hex;
  error?: string;
  result: {
    gasUsed: Hex;
    output: Hex;
  } | null;
  subtraces: number;
  traceAddress: number[];
  transactionHash: Hex;
  transactionPosition: number;
  type: "call";
};

export type SyncCreateTrace = {
  action: {
    from: Address;
    gas: Hex;
    init: Hex;
    value: Hex;
  };
  blockHash: Hex;
  blockNumber: Hex;
  result: {
    address: Address;
    code: Hex;
    gasUsed: Hex;
  } | null;
  subtraces: number;
  traceAddress: number[];
  transactionHash: Hex;
  transactionPosition: number;
  type: "create";
};

export type SyncSuicideTrace = {
  action: {
    address: Address;
    refundAddress: Address;
    balance: Hex;
  };
  blockHash: Hex;
  blockNumber: Hex;
  result: null;
  subtraces: number;
  traceAddress: number[];
  transactionHash: Hex;
  transactionPosition: number;
  type: "suicide";
};

export type SyncRewardTrace = {
  action: {
    author: Address;
    rewardType: "block" | "uncle";
    value: Hex;
  };
  blockHash: Hex;
  blockNumber: Hex;
  result: null;
  subtraces: number;
  traceAddress: number[];
  type: "reward";
};
