import type {
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransactionReceipt,
} from "@/types/sync.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import {
  type Address,
  BlockNotFoundError,
  type Hash,
  type Hex,
  type LogTopic,
  TransactionReceiptNotFoundError,
  numberToHex,
} from "viem";

/**
 * Helper function for "eth_getBlockByNumber" request.
 */
export const _eth_getBlockByNumber = (
  requestQueue: RequestQueue,
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
          : (blockNumber ?? blockTag),
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
  requestQueue: RequestQueue,
  { hash }: { hash: Hex },
): Promise<SyncBlock> =>
  requestQueue
    .request({
      method: "eth_getBlockByHash",
      params: [hash, true],
    })
    .then((_block) => {
      if (!_block)
        throw new BlockNotFoundError({
          blockHash: hash,
        });
      return _block as SyncBlock;
    });

/**
 * Helper function for "eth_getLogs" rpc request.
 * Handles different error types and retries the request if applicable.
 */
export const _eth_getLogs = async (
  requestQueue: RequestQueue,
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
  requestQueue: RequestQueue,
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
 * Helper function for "debug_traceBlockByNumber" request.
 */
export const _debug_traceBlockByNumber = (
  requestQueue: RequestQueue,
  {
    blockNumber,
  }: {
    blockNumber: Hex | number;
  },
): Promise<SyncTrace[]> =>
  requestQueue
    .request({
      method: "debug_traceBlockByNumber",
      params: [
        typeof blockNumber === "number"
          ? numberToHex(blockNumber)
          : blockNumber,
        { tracer: "callTracer" },
      ],
    } as any)
    .then((traces) => traces as unknown as SyncTrace[]);

/**
 * Helper function for "debug_traceBlockByHash" request.
 */
export const _debug_traceBlockByHash = (
  requestQueue: RequestQueue,
  {
    hash,
  }: {
    hash: Hash;
  },
): Promise<SyncTrace[]> =>
  requestQueue
    .request({
      method: "debug_traceBlockByHash",
      params: [hash, { tracer: "callTracer" }],
    } as any)
    .then((traces) => traces as unknown as SyncTrace[]);
