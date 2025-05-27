import type {
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransactionReceipt,
} from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import { toLowerCase } from "@/utils/lowercase.js";
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
  rpc: Rpc,
  {
    blockNumber,
    blockTag,
  }:
    | { blockNumber: Hex | number; blockTag?: never }
    | { blockNumber?: never; blockTag: "latest" },
): Promise<SyncBlock> =>
  rpc
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
  rpc: Rpc,
  { hash }: { hash: Hex },
): Promise<SyncBlock> =>
  rpc
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
  rpc: Rpc,
  params: {
    address?: Address | Address[];
    topics?: LogTopic[];
  } & (
    | { fromBlock: Hex | number; toBlock: Hex | number }
    | { blockHash: Hash }
  ),
): Promise<SyncLog[]> => {
  if ("blockHash" in params) {
    return rpc
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

  return rpc
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
  rpc: Rpc,
  { hash }: { hash: Hex },
): Promise<SyncTransactionReceipt> =>
  rpc
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
 * Helper function for "eth_getBlockReceipts" request.
 */
export const _eth_getBlockReceipts = (
  rpc: Rpc,
  { blockHash }: { blockHash: Hash },
): Promise<SyncTransactionReceipt[]> =>
  rpc
    .request({
      method: "eth_getBlockReceipts",
      params: [blockHash],
    } as any)
    .then((receipts) => receipts as unknown as SyncTransactionReceipt[]);

/**
 * Helper function for "debug_traceBlockByNumber" request.
 */
export const _debug_traceBlockByNumber = (
  rpc: Rpc,
  {
    blockNumber,
  }: {
    blockNumber: Hex | number;
  },
): Promise<SyncTrace[]> =>
  rpc
    .request({
      method: "debug_traceBlockByNumber",
      params: [
        typeof blockNumber === "number"
          ? numberToHex(blockNumber)
          : blockNumber,
        { tracer: "callTracer" },
      ],
    })
    .then((traces) => {
      const result: SyncTrace[] = [];
      let index = 0;
      // all traces that weren't included because the trace has an error
      // or the trace's parent has an error, mapped to the error string
      const failedTraces = new Map<
        (typeof traces)[number]["result"],
        { error?: string; revertReason?: string }
      >();

      const dfs = (
        frames: (typeof traces)[number]["result"][],
        transactionHash: Hex,
        parentFrame: (typeof traces)[number]["result"] | undefined,
      ) => {
        for (const frame of frames) {
          if (frame.error !== undefined) {
            failedTraces.set(frame, {
              error: frame.error,
              revertReason: frame.revertReason,
            });
          } else if (parentFrame && failedTraces.has(parentFrame)) {
            const error = failedTraces.get(parentFrame)!;

            frame.error = error.error;
            frame.revertReason = error.revertReason;

            failedTraces.set(frame, error);
          }

          // @ts-ignore
          frame.index = index;
          // @ts-ignore
          frame.subcalls = frame.calls?.length ?? 0;

          result.push({ trace: frame as SyncTrace["trace"], transactionHash });

          index++;

          if (frame.calls) {
            dfs(frame.calls, transactionHash, frame);
          }
        }
      };

      for (const trace of traces) {
        index = 0;
        dfs([trace.result], trace.txHash, undefined);
      }

      return result;
    });

/**
 * Helper function for "debug_traceBlockByHash" request.
 */
export const _debug_traceBlockByHash = (
  rpc: Rpc,
  {
    hash,
  }: {
    hash: Hash;
  },
): Promise<SyncTrace[]> =>
  rpc
    .request({
      method: "debug_traceBlockByHash",
      params: [hash, { tracer: "callTracer" }],
    })
    .then((traces) => {
      const result: SyncTrace[] = [];
      let index = 0;
      // all traces that weren't included because the trace has an error
      // or the trace's parent has an error, mapped to the error string
      const failedTraces = new Map<
        (typeof traces)[number]["result"],
        { error?: string; revertReason?: string }
      >();

      const dfs = (
        frames: (typeof traces)[number]["result"][],
        transactionHash: Hex,
        parentFrame: (typeof traces)[number]["result"] | undefined,
      ) => {
        for (const frame of frames) {
          if (frame.error !== undefined) {
            failedTraces.set(frame, {
              error: frame.error,
              revertReason: frame.revertReason,
            });
          } else if (parentFrame && failedTraces.has(parentFrame)) {
            const error = failedTraces.get(parentFrame)!;

            frame.error = error.error;
            frame.revertReason = error.revertReason;

            failedTraces.set(frame, error);
          }

          // @ts-ignore
          frame.index = index;
          // @ts-ignore
          frame.subcalls = frame.calls?.length ?? 0;

          result.push({ trace: frame as SyncTrace["trace"], transactionHash });

          index++;

          if (frame.calls) {
            dfs(frame.calls, transactionHash, frame);
          }
        }
      };

      for (const trace of traces) {
        index = 0;
        dfs([trace.result], trace.txHash, undefined);
      }

      return result;
    });
