import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import {
  type GetLogsRetryHelperParameters,
  getLogsRetryHelper,
} from "@ponder/utils";
import {
  type Address,
  BlockNotFoundError,
  type BlockTag,
  type Hash,
  type Hex,
  type Log,
  type LogTopic,
  type RpcBlock,
  RpcError,
  hexToBigInt,
  numberToHex,
} from "viem";

export type BaseSyncService = {
  common: Common;
  requestQueue: RequestQueue;
  network: Network;
};

export type SyncBlock = RpcBlock<Exclude<BlockTag, "pending">, true>;
export type SyncLog = Log<Hex, Hex, false>;

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
  { common, requestQueue }: Pick<BaseSyncService, "common" | "requestQueue">,
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

  const _params: GetLogsRetryHelperParameters["params"] = [
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
  ];

  try {
    return await requestQueue
      .request({
        method: "eth_getLogs",
        params: _params,
      })
      .then((l) => l as SyncLog[]);
  } catch (err) {
    const getLogsErrorResponse = getLogsRetryHelper({
      params: _params,
      error: err as RpcError,
    });

    if (!getLogsErrorResponse.shouldRetry) throw err;

    common.logger.debug({
      service: "historical",
      msg: `eth_getLogs request failed, retrying with ranges: [${getLogsErrorResponse.ranges
        .map(
          ({ fromBlock, toBlock }) =>
            `[${hexToBigInt(fromBlock).toString()}, ${hexToBigInt(
              toBlock,
            ).toString()}]`,
        )
        .join(", ")}].`,
    });

    return Promise.all(
      getLogsErrorResponse.ranges.map(({ fromBlock, toBlock }) =>
        _eth_getLogs(
          { common, requestQueue },
          {
            topics: _params[0].topics,
            address: _params[0].address,
            fromBlock,
            toBlock,
          },
        ),
      ),
    ).then((l) => l.flat());
  }
};
