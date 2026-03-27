import type { Rpc } from "@/rpc/index.js";
import type { Hex } from "viem";

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export type TableName =
  | "logs"
  | "blocks"
  | "traces"
  | "transactions"
  | "transfers";

// ---------------------------------------------------------------------------
// Block tags and block number types
// ---------------------------------------------------------------------------

export type BlockTag = "latest" | "earliest" | "safe" | "finalized";

export type BlockNumberOrTag = Hex | BlockTag;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Single value or non-empty array. */
type OneOrMany<T> = T | T[];

/** Topic position: single hash, array of hashes (OR), or null (wildcard). */
type TopicPosition = Hex | Hex[] | null;

export type LogFilter = {
  address?: OneOrMany<Hex>;
  topics?: TopicPosition[];
};

export type TransactionFilter = {
  from?: OneOrMany<Hex>;
  to?: OneOrMany<Hex>;
  type?: OneOrMany<number>;
  selector?: OneOrMany<Hex>;
};

export type TraceFilter = {
  from?: OneOrMany<Hex>;
  to?: OneOrMany<Hex>;
  traceType?: OneOrMany<string>;
  isTopLevel?: boolean;
  selector?: OneOrMany<Hex>;
};

export type BlockFilter = {
  number?: OneOrMany<Hex>;
  hash?: OneOrMany<Hex>;
};

export type TransferFilter = {
  from?: OneOrMany<Hex>;
  to?: OneOrMany<Hex>;
  isTopLevel?: boolean;
};

export type Filter =
  | LogFilter
  | TransactionFilter
  | TraceFilter
  | BlockFilter
  | TransferFilter;

// ---------------------------------------------------------------------------
// API Response Rows
// ---------------------------------------------------------------------------

export type ResponseLog = {
  blockNumber: Hex;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: Hex;
  logIndex: Hex;
  address: Hex;
  data: Hex;
  topics: Hex[];
};

export type ResponseBlock = {
  number: Hex;
  hash: Hex;
  parentHash: Hex;
  nonce: Hex;
  sha3Uncles: Hex;
  logsBloom: Hex;
  transactionsRoot: Hex;
  stateRoot: Hex;
  receiptsRoot: Hex;
  miner: Hex;
  mixHash: Hex | null;
  size: Hex;
  extraData: Hex;
  gasLimit: Hex;
  gasUsed: Hex;
  timestamp: Hex;
  baseFeePerGas: Hex;
  withdrawalsRoot: Hex;
  blobGasUsed: Hex;
  excessBlobGas: Hex;
  difficulty: Hex;
  totalDifficulty: Hex;
  withdrawals: string;
  parentBeaconBlockRoot: Hex | null;
  sealFields: Hex[];
};

export type ResponseTransfer = {
  blockNumber: Hex;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: Hex;
  from: Hex;
  to: Hex;
  value: Hex;
};

export type ResponseTrace = {
  blockNumber: Hex;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: Hex;
  type: string;
  from: Hex;
  to: Hex;
  gas: Hex;
  gasUsed: Hex;
  input: Hex;
  output: Hex;
  error: string;
  revertReason: string | null;
  value: Hex;
  traceAddress: number[];
  traceIndex: Hex | null;
  parentIndex: Hex | null;
  childIndexes: Hex[];
  isReverted: boolean | null;
};

export type ResponseTransaction = {
  hash: Hex;
  nonce: Hex;
  blockHash: Hex;
  blockNumber: Hex;
  transactionIndex: Hex;
  from: Hex;
  to: Hex;
  value: Hex;
  gas: Hex;
  gasPrice: Hex;
  input: Hex;
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
  type: Hex;
  blobVersionedHashes: Hex[];
  maxFeePerBlobGas: Hex;
  accessList: unknown[] | null;
  authorizationList: unknown[] | null;
  chainId: Hex | null;
  r: Hex | null;
  s: Hex | null;
  v: Hex | null;
  yParity: Hex | null;
};

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

type BaseQueryRequest = {
  /** Inclusive range start. Hex block number or tag. */
  fromBlock?: BlockNumberOrTag;
  /** Inclusive range end. Hex block number or tag. */
  toBlock?: BlockNumberOrTag;
  /** Traversal order. Defaults to "asc". */
  order?: "asc" | "desc";
  /** Fields to include per object type. Key is table name, value is array of field names or `true` for all. */
  fields?: Record<string, string[] | true>;
  /** Max primary objects to return. Hex-encoded. Defaults to "0x64" (100). */
  limit?: Hex;
};

export type QueryLogsRequest = BaseQueryRequest & {
  filter?: LogFilter;
};

export type QueryBlocksRequest = BaseQueryRequest & {
  filter?: BlockFilter;
};

export type QueryTransactionsRequest = BaseQueryRequest & {
  filter?: TransactionFilter;
};

export type QueryTracesRequest = BaseQueryRequest & {
  filter?: TraceFilter;
};

export type QueryTransfersRequest = BaseQueryRequest & {
  filter?: TransferFilter;
};

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export type BlockRef = {
  number: Hex;
  hash: Hex;
  parentHash: Hex;
};

export type QueryResponseData = {
  blocks?: Partial<ResponseBlock>[];
  transactions?: Partial<ResponseTransaction>[];
  logs?: Partial<ResponseLog>[];
  traces?: Partial<ResponseTrace>[];
  transfers?: Partial<ResponseTransfer>[];
};

export type QueryResponse = {
  fromBlock: BlockRef;
  toBlock: BlockRef;
  cursorBlock: BlockRef;
  data: QueryResponseData;
};

// ---------------------------------------------------------------------------
// RPC Schema (extend the main RpcSchema with these)
// ---------------------------------------------------------------------------

export type QueryRpcSchema = [
  {
    Method: "eth_queryLogs";
    Parameters: [request: QueryLogsRequest];
    ReturnType: QueryResponse;
  },
  {
    Method: "eth_queryBlocks";
    Parameters: [request: QueryBlocksRequest];
    ReturnType: QueryResponse;
  },
  {
    Method: "eth_queryTransactions";
    Parameters: [request: QueryTransactionsRequest];
    ReturnType: QueryResponse;
  },
  {
    Method: "eth_queryTraces";
    Parameters: [request: QueryTracesRequest];
    ReturnType: QueryResponse;
  },
  {
    Method: "eth_queryTransfers";
    Parameters: [request: QueryTransfersRequest];
    ReturnType: QueryResponse;
  },
];

// ---------------------------------------------------------------------------
// Action helpers
// ---------------------------------------------------------------------------

/**
 * Helper for "eth_queryLogs".
 */
export const eth_queryLogs = async (
  rpc: Rpc,
  params: QueryLogsRequest,
  context?: Parameters<Rpc["request"]>[1],
): Promise<QueryResponse> => {
  return rpc.request(
    { method: "eth_queryLogs", params: [params] },
    context,
  ) as Promise<QueryResponse>;
};

/**
 * Helper for "eth_queryBlocks".
 */
export const eth_queryBlocks = async (
  rpc: Rpc,
  params: QueryBlocksRequest,
  context?: Parameters<Rpc["request"]>[1],
): Promise<QueryResponse> => {
  return rpc.request(
    { method: "eth_queryBlocks", params: [params] },
    context,
  ) as Promise<QueryResponse>;
};

/**
 * Helper for "eth_queryTransactions".
 */
export const eth_queryTransactions = async (
  rpc: Rpc,
  params: QueryTransactionsRequest,
  context?: Parameters<Rpc["request"]>[1],
): Promise<QueryResponse> => {
  return rpc.request(
    { method: "eth_queryTransactions", params: [params] },
    context,
  ) as Promise<QueryResponse>;
};

/**
 * Helper for "eth_queryTraces".
 */
export const eth_queryTraces = async (
  rpc: Rpc,
  params: QueryTracesRequest,
  context?: Parameters<Rpc["request"]>[1],
): Promise<QueryResponse> => {
  return rpc.request(
    { method: "eth_queryTraces", params: [params] },
    context,
  ) as Promise<QueryResponse>;
};

/**
 * Helper for "eth_queryTransfers".
 */
export const eth_queryTransfers = async (
  rpc: Rpc,
  params: QueryTransfersRequest,
  context?: Parameters<Rpc["request"]>[1],
): Promise<QueryResponse> => {
  return rpc.request(
    { method: "eth_queryTransfers", params: [params] },
    context,
  ) as Promise<QueryResponse>;
};

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

type QueryActionFn<R> = (
  rpc: Rpc,
  params: R,
  context?: Parameters<Rpc["request"]>[1],
) => Promise<QueryResponse>;

/**
 * Auto-paginate any query method. Collects all pages and merges the `data`
 * arrays. Returns the merged response with `fromBlock` from the first page
 * and `toBlock`/`cursorBlock` from the last page.
 *
 * @example
 * const allLogs = await paginate(eth_queryLogs, rpc, {
 *   fromBlock: "0x0",
 *   toBlock: "0x1000",
 *   limit: "0x2710",
 *   filter: { address: "0x..." },
 *   fields: { logs: true, blocks: ["number", "timestamp"] },
 * });
 */
export async function paginate<
  R extends {
    fromBlock?: BlockNumberOrTag;
    toBlock?: BlockNumberOrTag;
    order?: "asc" | "desc";
  },
>(
  action: QueryActionFn<R>,
  rpc: Rpc,
  params: R,
  context?: Parameters<Rpc["request"]>[1],
): Promise<QueryResponse> {
  const order = params.order ?? "asc";

  let currentParams = { ...params };
  let merged: QueryResponse | undefined;

  while (true) {
    const page = await action(rpc, currentParams, context);

    if (merged === undefined) {
      merged = page;
    } else {
      for (const _key of Object.keys(page.data)) {
        const key = _key as keyof QueryResponseData;
        const existing = merged.data[key] as unknown[] | undefined;
        const incoming = page.data[key] as unknown[] | undefined;
        if (incoming) {
          if (existing) {
            (merged.data as Record<string, unknown[]>)[key] = [
              ...existing,
              ...incoming,
            ];
          } else {
            (merged.data as Record<string, unknown[]>)[key] = incoming;
          }
        }
      }
      merged.toBlock = page.toBlock;
      merged.cursorBlock = page.cursorBlock;
    }

    // Pagination complete when cursorBlock reaches toBlock
    if (page.cursorBlock.number === page.toBlock.number) {
      break;
    }

    // Advance past the cursor for the next page
    const cursorNumber = BigInt(page.cursorBlock.number);
    const nextBlock =
      order === "asc"
        ? (`0x${(cursorNumber + 1n).toString(16)}` as Hex)
        : (`0x${(cursorNumber - 1n).toString(16)}` as Hex);

    currentParams = { ...currentParams, fromBlock: nextBlock };
  }

  return merged!;
}
