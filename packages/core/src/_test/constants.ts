import type {
  BlockFilter,
  LogFilter,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";

// Test accounts
export const ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
] as const;

// Named accounts
export const [ALICE, BOB] = ACCOUNTS;

export const EMPTY_LOG_FILTER: LogFilter = {
  type: "log",
  chainId: 1,
  address: undefined,
  topic0: null,
  topic1: null,
  topic2: null,
  topic3: null,
  fromBlock: undefined,
  toBlock: undefined,
  hasTransactionReceipt: false,
  include: [],
};

export const EMPTY_BLOCK_FILTER: BlockFilter = {
  type: "block",
  chainId: 1,
  interval: 1,
  offset: 0,
  fromBlock: undefined,
  toBlock: undefined,
  hasTransactionReceipt: false,
  include: [],
};

export const EMPTY_TRANSACTION_FILTER: TransactionFilter = {
  type: "transaction",
  chainId: 1,
  fromAddress: undefined,
  toAddress: undefined,
  includeReverted: false,
  fromBlock: undefined,
  toBlock: undefined,
  hasTransactionReceipt: true,
  include: [],
};

export const EMPTY_TRACE_FILTER: TraceFilter = {
  type: "trace",
  chainId: 1,
  callType: "CALL",
  functionSelector: undefined,
  fromAddress: undefined,
  toAddress: undefined,
  includeReverted: false,
  fromBlock: undefined,
  toBlock: undefined,
  hasTransactionReceipt: false,
  include: [],
};

export const EMPTY_TRANSFER_FILTER: TransferFilter = {
  type: "transfer",
  chainId: 1,
  fromAddress: undefined,
  toAddress: undefined,
  includeReverted: false,
  fromBlock: undefined,
  toBlock: undefined,
  hasTransactionReceipt: false,
  include: [],
};
