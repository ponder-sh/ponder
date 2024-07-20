import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import { type Extend, extend } from "@/utils/extend.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import {
  type Address,
  BlockNotFoundError,
  type BlockTag,
  type Hash,
  type Hex,
  type Log,
  type LogTopic,
  type RpcBlock,
  type RpcTransaction,
  type RpcTransactionReceipt,
  TransactionReceiptNotFoundError,
  numberToHex,
} from "viem";
import {
  type Service,
  create,
  getCachedTransport,
  getHistoricalCheckpoint,
  getStatusBlocks,
  kill,
  startHistorical,
  startRealtime,
} from "./service.js";

const methods = {
  startHistorical,
  getHistoricalCheckpoint,
  getStatusBlocks,
  startRealtime,
  getCachedTransport,
  kill,
};

export const createSyncService = extend(create, methods);

export type SyncService = Extend<Service, typeof methods>;

export type BaseSyncService = {
  common: Common;
  requestQueue: RequestQueue;
  network: Network;
};

export type SyncBlock = RpcBlock<Exclude<BlockTag, "pending">, true>;
export type SyncLog = Log<Hex, Hex, false>;
export type SyncTransaction = RpcTransaction;
export type SyncTransactionReceipt = RpcTransactionReceipt;
export type SyncTrace =
  | SyncCallTrace
  | SyncCreateTrace
  | SyncRewardTrace
  | SyncSuicideTrace;
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

/**
 * Helper function for "eth_getBlockByNumber" request.
 */
export const _eth_getBlockByNumber = (
  { requestQueue }: Pick<BaseSyncService, "requestQueue">,
  {
    blockNumber,
    blockTag,
  }:
    | { blockNumber: Hex | number; blockTag?: never }
    | { blockNumber?: never; blockTag: "latest" },
): Promise<SyncBlock> =>
  requestQueue
    .request({
      method: "eth_getBlockByNumber",
      params: [
        typeof blockNumber === "number"
          ? numberToHex(blockNumber)
          : blockNumber ?? blockTag,
        true,
      ],
    })
    .then((_block) => {
      if (!_block)
        throw new BlockNotFoundError({
          blockNumber: (blockNumber ?? blockTag) as any,
        });
      return _block as SyncBlock;
    });

/**
 * Helper function for "eth_getBlockByNumber" request.
 */
export const _eth_getBlockByHash = (
  { requestQueue }: Pick<BaseSyncService, "requestQueue">,
  { blockHash }: { blockHash: Hex },
): Promise<SyncBlock> =>
  requestQueue
    .request({
      method: "eth_getBlockByHash",
      params: [blockHash, true],
    })
    .then((_block) => {
      if (!_block)
        throw new BlockNotFoundError({
          blockHash,
        });
      return _block as SyncBlock;
    });

/**
 * Helper function for "eth_getLogs" rpc request.
 * Handles different error types and retries the request if applicable.
 */
export const _eth_getLogs = async (
  { requestQueue }: Pick<BaseSyncService, "requestQueue">,
  params: {
    address?: Address | Address[];
    topics?: LogTopic[];
  } & (
    | { fromBlock: Hex | number; toBlock: Hex | number }
    | { blockHash: Hash }
  ),
): Promise<SyncLog[]> => {
  if ("blockHash" in params) {
    return requestQueue
      .request({
        method: "eth_getLogs",
        params: [
          {
            blockHash: params.blockHash,

            topics: params.topics,
            address: params.address
              ? Array.isArray(params.address)
                ? params.address.map((a) => toLowerCase(a))
                : toLowerCase(params.address)
              : undefined,
          },
        ],
      })
      .then((l) => l as SyncLog[]);
  }

  return requestQueue
    .request({
      method: "eth_getLogs",
      params: [
        {
          fromBlock:
            typeof params.fromBlock === "number"
              ? numberToHex(params.fromBlock)
              : params.fromBlock,
          toBlock:
            typeof params.toBlock === "number"
              ? numberToHex(params.toBlock)
              : params.toBlock,

          topics: params.topics,
          address: params.address
            ? Array.isArray(params.address)
              ? params.address.map((a) => toLowerCase(a))
              : toLowerCase(params.address)
            : undefined,
        },
      ],
    })
    .then((l) => l as SyncLog[]);
};

/**
 * Helper function for "eth_getTransactionReceipt" request.
 */
export const _eth_getTransactionReceipt = (
  { requestQueue }: Pick<BaseSyncService, "requestQueue">,
  { hash }: { hash: Hex },
): Promise<SyncTransactionReceipt> =>
  requestQueue
    .request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })
    .then((receipt) => {
      if (!receipt)
        throw new TransactionReceiptNotFoundError({
          hash,
        });
      return receipt as SyncTransactionReceipt;
    });

/**
 * Helper function for "trace_filter" request.
 *
 * Note: No strict typing is available.
 */
export const _trace_filter = (
  { requestQueue }: Pick<BaseSyncService, "requestQueue">,
  params: {
    fromBlock: Hex | number;
    toBlock: Hex | number;
    fromAddress?: Address[];
    toAddress?: Address[];
  },
): Promise<SyncTrace[]> =>
  requestQueue
    .request({
      method: "trace_filter",
      params: [
        {
          fromBlock:
            typeof params.fromBlock === "number"
              ? numberToHex(params.fromBlock)
              : params.fromBlock,
          toBlock:
            typeof params.toBlock === "number"
              ? numberToHex(params.toBlock)
              : params.toBlock,
          fromAddress: params.fromAddress
            ? params.fromAddress.map((a) => toLowerCase(a))
            : undefined,
          toAddress: params.toAddress
            ? params.toAddress.map((a) => toLowerCase(a))
            : undefined,
        },
      ],
    } as any)
    .then((traces) => traces as unknown as SyncTrace[]);

/**
 * Helper function for "trace_block" request.
 *
 * Note: No strict typing is available.
 */
export const _trace_block = (
  { requestQueue }: Pick<BaseSyncService, "requestQueue">,
  params: {
    blockNumber: Hex | number;
  },
): Promise<SyncTrace[]> =>
  requestQueue
    .request({
      method: "trace_block",
      params: [
        typeof params.blockNumber === "number"
          ? numberToHex(params.blockNumber)
          : params.blockNumber,
      ],
    } as any)
    .then((traces) => traces as unknown as SyncTrace[]);
