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
  type RpcTransactionReceipt,
  TransactionReceiptNotFoundError,
  numberToHex,
} from "viem";
import {
  type Service,
  create,
  getCachedTransport,
  getHistoricalCheckpoint,
  kill,
  startHistorical,
  startRealtime,
} from "./service.js";

const methods = {
  startHistorical,
  getHistoricalCheckpoint,
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
export type SyncTransactionReceipt = RpcTransactionReceipt;

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
