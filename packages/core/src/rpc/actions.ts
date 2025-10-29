import { RpcProviderError } from "@/internal/errors.js";
import type {
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import { zeroLogsBloom } from "@/sync-realtime/bloom.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { PG_BIGINT_MAX, PG_INTEGER_MAX } from "@/utils/pg.js";
import {
  type Address,
  BlockNotFoundError,
  type Hash,
  type Hex,
  type LogTopic,
  TransactionReceiptNotFoundError,
  hexToBigInt,
  hexToNumber,
  numberToHex,
  toHex,
  zeroAddress,
  zeroHash,
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
  context?: Parameters<Rpc["request"]>[1],
): Promise<SyncBlock> =>
  rpc
    .request(
      {
        method: "eth_getBlockByNumber",
        params: [
          typeof blockNumber === "number"
            ? numberToHex(blockNumber)
            : (blockNumber ?? blockTag),
          true,
        ],
      },
      context,
    )
    .then((_block) => {
      if (!_block)
        throw new BlockNotFoundError({
          blockNumber: (blockNumber ?? blockTag) as any,
        });
      return standardizeBlock(_block as SyncBlock, "number");
    });

/**
 * Helper function for "eth_getBlockByNumber" request.
 */
export const _eth_getBlockByHash = (
  rpc: Rpc,
  { hash }: { hash: Hex },
  context?: Parameters<Rpc["request"]>[1],
): Promise<SyncBlock> =>
  rpc
    .request(
      {
        method: "eth_getBlockByHash",
        params: [hash, true],
      },
      context,
    )
    .then((_block) => {
      if (!_block)
        throw new BlockNotFoundError({
          blockHash: hash,
        });
      return standardizeBlock(_block as SyncBlock, "hash");
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
  context?: Parameters<Rpc["request"]>[1],
): Promise<SyncLog[]> => {
  if ("blockHash" in params) {
    return rpc
      .request(
        {
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
        },
        context,
      )
      .then((l) => {
        if (l === null || l === undefined) {
          throw new Error("Received invalid empty eth_getLogs response.");
        }

        return (l as SyncLog[]).map(standardizeLog);
      });
  }

  return rpc
    .request(
      {
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
      },
      context,
    )
    .then((l) => {
      if (l === null || l === undefined) {
        throw new Error("Received invalid empty eth_getLogs response.");
      }

      return (l as SyncLog[]).map(standardizeLog);
    });
};

/**
 * Helper function for "eth_getTransactionReceipt" request.
 */
export const _eth_getTransactionReceipt = (
  rpc: Rpc,
  { hash }: { hash: Hex },
  context?: Parameters<Rpc["request"]>[1],
): Promise<SyncTransactionReceipt> =>
  rpc
    .request(
      {
        method: "eth_getTransactionReceipt",
        params: [hash],
      },
      context,
    )
    .then((receipt) => {
      if (!receipt)
        throw new TransactionReceiptNotFoundError({
          hash,
        });
      return standardizeTransactionReceipt(
        receipt as SyncTransactionReceipt,
        "eth_getTransactionReceipt",
      );
    });

/**
 * Helper function for "eth_getBlockReceipts" request.
 */
export const _eth_getBlockReceipts = (
  rpc: Rpc,
  { blockHash }: { blockHash: Hash },
  context?: Parameters<Rpc["request"]>[1],
): Promise<SyncTransactionReceipt[]> =>
  rpc
    .request(
      {
        method: "eth_getBlockReceipts",
        params: [blockHash],
      },
      context,
    )
    .then((receipts) => {
      if (receipts === null || receipts === undefined) {
        throw new Error(
          "Received invalid empty eth_getBlockReceipts response.",
        );
      }

      return receipts.map((receipt) =>
        standardizeTransactionReceipt(receipt, "eth_getBlockReceipts"),
      );
    });

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
  context?: Parameters<Rpc["request"]>[1],
): Promise<SyncTrace[]> =>
  rpc
    .request(
      {
        method: "debug_traceBlockByNumber",
        params: [
          typeof blockNumber === "number"
            ? numberToHex(blockNumber)
            : blockNumber,
          { tracer: "callTracer" },
        ],
      },
      context,
    )
    .then((traces) => {
      if (traces === null || traces === undefined) {
        throw new Error(
          "Received invalid empty debug_traceBlockByNumber response.",
        );
      }

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

      return result.map(standardizeTrace);
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
  context?: Parameters<Rpc["request"]>[1],
): Promise<SyncTrace[]> =>
  rpc
    .request(
      {
        method: "debug_traceBlockByHash",
        params: [hash, { tracer: "callTracer" }],
      },
      context,
    )
    .then((traces) => {
      if (traces === null || traces === undefined) {
        throw new Error(
          "Received invalid empty debug_traceBlockByHash response.",
        );
      }

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

      return result.map(standardizeTrace);
    });

/**
 * Validate that the transactions are consistent with the block.
 */
export const validateTransactionsAndBlock = (
  block: SyncBlock,
  blockIdentifier: "number" | "hash",
) => {
  const transactionIds = new Set<Hex>();
  for (const [index, transaction] of block.transactions.entries()) {
    if (block.hash !== transaction.blockHash) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The transaction at index ${index} of the 'block.transactions' array has a 'transaction.blockHash' of ${transaction.blockHash}, but the block itself has a 'block.hash' of ${block.hash}.`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        eth_getBlockText(
          blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
        ),
      ];
      error.stack = undefined;
      throw error;
    }

    if (block.number !== transaction.blockNumber) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The transaction at index ${index} of the 'block.transactions' array has a 'transaction.blockNumber' of ${transaction.blockNumber} (${hexToNumber(transaction.blockNumber)}), but the block itself has a 'block.number' of ${block.number} (${hexToNumber(block.number)}).`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        eth_getBlockText(
          blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
        ),
      ];
      error.stack = undefined;
      throw error;
    }

    if (transactionIds.has(transaction.transactionIndex)) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The 'block.transactions' array contains two objects with a 'transactionIndex' of ${transaction.transactionIndex} (${hexToNumber(transaction.transactionIndex)}). The duplicate was found at array index ${index}.`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        eth_getBlockText(
          blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
        ),
      ];
      error.stack = undefined;
      throw error;
    } else {
      transactionIds.add(transaction.transactionIndex);
    }
  }
};

/**
 * Validate that the logs are consistent with the block.
 *
 * @dev Allows `log.transactionHash` to be `zeroHash`.
 * @dev Allows `block.logsBloom` to be `zeroLogsBloom`.
 */
export const validateLogsAndBlock = (
  logs: SyncLog[],
  block: SyncBlock,
  blockIdentifier: "number" | "hash",
) => {
  if (block.logsBloom !== zeroLogsBloom && logs.length === 0) {
    const error = new RpcProviderError(
      `Inconsistent RPC response data. The logs array has length 0, but the associated block has a non-empty 'block.logsBloom'.`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getBlockText(
        blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
      ),
      eth_getLogsText(
        blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
      ),
    ];
    error.stack = undefined;
    throw error;
  }

  const logIndexes = new Set<string>();
  const transactionByIndex = new Map<Hex, SyncTransaction>(
    block.transactions.map((transaction) => [
      transaction.transactionIndex,
      transaction,
    ]),
  );

  for (const [index, log] of logs.entries()) {
    if (block.hash !== log.blockHash) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The log with 'logIndex' ${log.logIndex} (${hexToNumber(log.logIndex)}) has a 'log.blockHash' of ${log.blockHash}, but the associated block has a 'block.hash' of ${block.hash}.`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        eth_getBlockText(
          blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
        ),
        eth_getLogsText(
          blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
        ),
      ];
      error.stack = undefined;
      throw error;
    }

    if (block.number !== log.blockNumber) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The log with 'logIndex' ${log.logIndex} (${hexToNumber(log.logIndex)}) has a 'log.blockNumber' of ${log.blockNumber} (${hexToNumber(log.blockNumber)}), but the associated block has a 'block.number' of ${block.number} (${hexToNumber(block.number)}).`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        eth_getBlockText(
          blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
        ),
        eth_getLogsText(
          blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
        ),
      ];
      error.stack = undefined;
      throw error;
    }

    if (log.transactionHash !== zeroHash) {
      const transaction = transactionByIndex.get(log.transactionIndex);
      if (transaction === undefined) {
        const error = new RpcProviderError(
          `Inconsistent RPC response data. The log with 'logIndex' ${log.logIndex} (${hexToNumber(log.logIndex)}) has a 'log.transactionIndex' of ${log.transactionIndex} (${hexToNumber(log.transactionIndex)}), but the associated 'block.transactions' array does not contain a transaction matching that 'transactionIndex'.`,
        );
        error.meta = [
          "Please report this error to the RPC operator.",
          eth_getBlockText(
            blockIdentifier === "number"
              ? hexToNumber(block.number)
              : block.hash,
          ),
          eth_getLogsText(
            blockIdentifier === "number"
              ? hexToNumber(block.number)
              : block.hash,
          ),
        ];
        error.stack = undefined;
        throw error;
      } else if (transaction.hash !== log.transactionHash) {
        const error = new RpcProviderError(
          `Inconsistent RPC response data. The log with 'logIndex' ${log.logIndex} (${hexToNumber(log.logIndex)}) matches a transaction in the associated 'block.transactions' array by 'transactionIndex' ${log.transactionIndex} (${hexToNumber(log.transactionIndex)}), but the log has a 'log.transactionHash' of ${log.transactionHash} while the transaction has a 'transaction.hash' of ${transaction.hash}.`,
        );
        error.meta = [
          "Please report this error to the RPC operator.",
          eth_getBlockText(
            blockIdentifier === "number"
              ? hexToNumber(block.number)
              : block.hash,
          ),
          eth_getLogsText(
            blockIdentifier === "number"
              ? hexToNumber(block.number)
              : block.hash,
          ),
        ];
        error.stack = undefined;
        throw error;
      }
    }

    if (logIndexes.has(log.logIndex)) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The logs array contains two objects with 'logIndex' ${log.logIndex} (${hexToNumber(log.logIndex)}). The duplicate was found at array index ${index}.`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        eth_getBlockText(
          blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
        ),
        eth_getLogsText(
          blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
        ),
      ];
      error.stack = undefined;
      throw error;
    } else {
      logIndexes.add(log.logIndex);
    }
  }
};

/**
 * Validate that the traces are consistent with the block.
 */
export const validateTracesAndBlock = (
  traces: SyncTrace[],
  block: SyncBlock,
  blockIdentifier: "number" | "hash",
) => {
  const transactionHashes = new Set(block.transactions.map((t) => t.hash));
  for (const [index, trace] of traces.entries()) {
    if (transactionHashes.has(trace.transactionHash) === false) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The top-level trace at array index ${index} has a 'transactionHash' of ${trace.transactionHash}, but the associated 'block.transactions' array does not contain a transaction matching that hash.`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        eth_getBlockText(
          blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
        ),
        debug_traceBlockText(
          blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
        ),
      ];
      error.stack = undefined;
      throw error;
    }
  }

  // Use the fact that any transaction produces a trace to validate.
  if (block.transactions.length !== 0 && traces.length === 0) {
    const error = new RpcProviderError(
      `Inconsistent RPC response data. The traces array has length 0, but the associated 'block.transactions' array has length ${block.transactions.length}.`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getBlockText(
        blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
      ),
      debug_traceBlockText(
        blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
      ),
    ];
    error.stack = undefined;
    throw error;
  }
};

/**
 * Validate that the receipts are consistent with the block.
 */
export const validateReceiptsAndBlock = (
  receipts: SyncTransactionReceipt[],
  block: SyncBlock,
  method: "eth_getBlockReceipts" | "eth_getTransactionReceipt",
  blockIdentifier: "number" | "hash",
) => {
  const receiptIds = new Set<string>();

  for (const [index, receipt] of receipts.entries()) {
    const id = receipt.transactionHash;
    if (receiptIds.has(id)) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The receipts array contains two objects with a 'transactionHash' of ${receipt.transactionHash}. The duplicate was found at array index ${index}.`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        eth_getBlockText(
          blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
        ),
        method === "eth_getBlockReceipts"
          ? eth_getBlockReceiptsText(block.hash)
          : eth_getTransactionReceiptText(receipt.transactionHash),
      ];
      error.stack = undefined;
      throw error;
    } else {
      receiptIds.add(id);
    }
  }

  const transactionByIndex = new Map<Hex, SyncTransaction>(
    block.transactions.map((transaction) => [
      transaction.transactionIndex,
      transaction,
    ]),
  );

  for (const [index, receipt] of receipts.entries()) {
    if (block.hash !== receipt.blockHash) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The receipt at array index ${index} has a 'receipt.blockHash' of ${receipt.blockHash}, but the associated block has a 'block.hash' of ${block.hash}.`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        eth_getBlockText(
          blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
        ),
        method === "eth_getBlockReceipts"
          ? eth_getBlockReceiptsText(block.hash)
          : eth_getTransactionReceiptText(receipt.transactionHash),
      ];
      error.stack = undefined;
      throw error;
    }

    if (block.number !== receipt.blockNumber) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The receipt at array index ${index} has a 'receipt.blockNumber' of ${receipt.blockNumber} (${hexToNumber(receipt.blockNumber)}), but the associated block has a 'block.number' of ${block.number} (${hexToNumber(block.number)}).`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        eth_getBlockText(
          blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
        ),
        method === "eth_getBlockReceipts"
          ? eth_getBlockReceiptsText(block.hash)
          : eth_getTransactionReceiptText(receipt.transactionHash),
      ];
      error.stack = undefined;
      throw error;
    }

    const transaction = transactionByIndex.get(receipt.transactionIndex);
    if (transaction === undefined) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The receipt at array index ${index} has a 'receipt.transactionIndex' of ${receipt.transactionIndex} (${hexToNumber(receipt.transactionIndex)}), but the associated 'block.transactions' array does not contain a transaction matching that 'transactionIndex'.`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        eth_getBlockText(
          blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
        ),
        method === "eth_getBlockReceipts"
          ? eth_getBlockReceiptsText(block.hash)
          : eth_getTransactionReceiptText(receipt.transactionHash),
      ];
      error.stack = undefined;
      throw error;
    } else if (transaction.hash !== receipt.transactionHash) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The receipt at array index ${index} matches a transaction in the associated 'block.transactions' array by 'transactionIndex' ${receipt.transactionIndex} (${hexToNumber(receipt.transactionIndex)}), but the receipt has a 'receipt.transactionHash' of ${receipt.transactionHash} while the transaction has a 'transaction.hash' of ${transaction.hash}.`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        eth_getBlockText(
          blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
        ),
        method === "eth_getBlockReceipts"
          ? eth_getBlockReceiptsText(block.hash)
          : eth_getTransactionReceiptText(receipt.transactionHash),
      ];
      error.stack = undefined;
      throw error;
    }
  }

  if (
    method === "eth_getBlockReceipts" &&
    block.transactions.length !== receipts.length
  ) {
    const error = new RpcProviderError(
      `Inconsistent RPC response data. The receipts array has length ${receipts.length}, but the associated 'block.transactions' array has length ${block.transactions.length}.`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getBlockText(
        blockIdentifier === "number" ? hexToNumber(block.number) : block.hash,
      ),
      eth_getBlockReceiptsText(block.hash),
    ];
    error.stack = undefined;
    throw error;
  }
};

/**
 * Validate required block properties and set non-required properties.
 *
 * Required properties:
 * - hash
 * - number
 * - timestamp
 * - logsBloom
 * - parentHash
 * - transactions
 *
 * Non-required properties:
 * - miner
 * - gasUsed
 * - gasLimit
 * - baseFeePerGas
 * - nonce
 * - mixHash
 * - stateRoot
 * - transactionsRoot
 * - sha3Uncles
 * - size
 * - difficulty
 * - totalDifficulty
 * - extraData
 */
export const standardizeBlock = <
  block extends
    | SyncBlock
    | (Omit<SyncBlock, "transactions"> & {
        transactions: string[] | undefined;
      }),
>(
  block: block,
  blockIdentifier: "number" | "hash" | "newHeads",
  isBlockHeader = false,
): block extends SyncBlock ? SyncBlock : SyncBlockHeader => {
  // required properties
  if (block.hash === undefined) {
    const error = new RpcProviderError("'block.hash' is a required property");
    error.meta = [
      "Please report this error to the RPC operator.",
      blockIdentifier === "newHeads"
        ? eth_subscribeNewHeadsText()
        : eth_getBlockText(
            blockIdentifier === "number"
              ? hexToNumber(block.number)
              : block.hash,
          ),
    ];
    error.stack = undefined;
    throw error;
  }
  if (block.number === undefined) {
    const error = new RpcProviderError("'block.number' is a required property");
    error.meta = [
      "Please report this error to the RPC operator.",
      blockIdentifier === "newHeads"
        ? eth_subscribeNewHeadsText()
        : eth_getBlockText(
            blockIdentifier === "number"
              ? hexToNumber(block.number)
              : block.hash,
          ),
    ];
    error.stack = undefined;
    throw error;
  }
  if (block.timestamp === undefined) {
    const error = new RpcProviderError(
      "'block.timestamp' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      blockIdentifier === "newHeads"
        ? eth_subscribeNewHeadsText()
        : eth_getBlockText(
            blockIdentifier === "number"
              ? hexToNumber(block.number)
              : block.hash,
          ),
    ];
    error.stack = undefined;
    throw error;
  }
  if (block.logsBloom === undefined) {
    const error = new RpcProviderError(
      "'block.logsBloom' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      blockIdentifier === "newHeads"
        ? eth_subscribeNewHeadsText()
        : eth_getBlockText(
            blockIdentifier === "number"
              ? hexToNumber(block.number)
              : block.hash,
          ),
    ];
    error.stack = undefined;
    throw error;
  }
  if (block.parentHash === undefined) {
    const error = new RpcProviderError(
      "'block.parentHash' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      blockIdentifier === "newHeads"
        ? eth_subscribeNewHeadsText()
        : eth_getBlockText(
            blockIdentifier === "number"
              ? hexToNumber(block.number)
              : block.hash,
          ),
    ];
    error.stack = undefined;
    throw error;
  }

  // non-required properties
  if (block.miner === undefined) {
    block.miner = zeroAddress;
  }
  if (block.gasUsed === undefined) {
    block.gasUsed = "0x0";
  }
  if (block.gasLimit === undefined) {
    block.gasLimit = "0x0";
  }
  if (block.baseFeePerGas === undefined) {
    block.baseFeePerGas = "0x0";
  }
  if (block.nonce === undefined) {
    block.nonce = "0x0";
  }
  if (block.mixHash === undefined) {
    block.mixHash = zeroHash;
  }
  if (block.stateRoot === undefined) {
    block.stateRoot = zeroHash;
  }
  if (block.transactionsRoot === undefined) {
    block.transactionsRoot = zeroHash;
  }
  if (block.sha3Uncles === undefined) {
    block.sha3Uncles = zeroHash;
  }
  if (block.size === undefined) {
    block.size = "0x0";
  }
  if (block.difficulty === undefined) {
    block.difficulty = "0x0";
  }
  if (block.totalDifficulty === undefined) {
    block.totalDifficulty = "0x0";
  }
  if (block.extraData === undefined) {
    block.extraData = "0x";
  }

  if (hexToBigInt(block.number) > PG_BIGINT_MAX) {
    const error = new RpcProviderError(
      `'block.number' is larger than the maximum allowed value. ${hexToBigInt(block.number)} > ${PG_BIGINT_MAX}`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      blockIdentifier === "newHeads"
        ? eth_subscribeNewHeadsText()
        : eth_getBlockText(
            blockIdentifier === "number"
              ? hexToNumber(block.number)
              : block.hash,
          ),
    ];
    error.stack = undefined;
    throw error;
  }
  if (hexToBigInt(block.timestamp) > PG_BIGINT_MAX) {
    const error = new RpcProviderError(
      `'block.timestamp' is larger than the maximum allowed value. ${hexToBigInt(block.timestamp)} > ${PG_BIGINT_MAX}`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      blockIdentifier === "newHeads"
        ? eth_subscribeNewHeadsText()
        : eth_getBlockText(
            blockIdentifier === "number"
              ? hexToNumber(block.number)
              : block.hash,
          ),
    ];
    error.stack = undefined;
    throw error;
  }

  // Note: block headers for some providers may contain transactions hashes,
  // but Ponder coerces the transactions property to undefined.

  if (isBlockHeader) {
    block.transactions = undefined;

    return block as block extends SyncBlock ? SyncBlock : SyncBlockHeader;
  } else {
    if (block.transactions === undefined) {
      throw new Error("'block.transactions' is a required property");
    }

    block.transactions = (block as SyncBlock).transactions.map((transaction) =>
      standardizeTransaction(transaction, blockIdentifier as "number" | "hash"),
    );

    return block as block extends SyncBlock ? SyncBlock : SyncBlockHeader;
  }
};

/**
 * Validate required transaction properties and set non-required properties.
 *
 * Required properties:
 * - hash
 * - transactionIndex
 * - blockNumber
 * - blockHash
 * - from
 * - to
 *
 * Non-required properties:
 * - input
 * - value
 * - nonce
 * - r
 * - s
 * - v
 * - type
 * - gas
 */
export const standardizeTransaction = (
  transaction: SyncTransaction,
  blockIdentifier: "number" | "hash",
): SyncTransaction => {
  // required properties
  if (transaction.hash === undefined) {
    const error = new RpcProviderError(
      "'transaction.hash' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getBlockText(
        blockIdentifier === "number"
          ? hexToNumber(transaction.blockNumber)
          : transaction.blockHash,
      ),
    ];
    error.stack = undefined;
    throw error;
  }
  if (transaction.transactionIndex === undefined) {
    const error = new RpcProviderError(
      "'transaction.transactionIndex' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getBlockText(
        blockIdentifier === "number"
          ? hexToNumber(transaction.blockNumber)
          : transaction.blockHash,
      ),
    ];
    error.stack = undefined;
    throw error;
  }
  if (transaction.blockNumber === undefined) {
    const error = new RpcProviderError(
      "'transaction.blockNumber' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getBlockText(
        blockIdentifier === "number"
          ? hexToNumber(transaction.blockNumber)
          : transaction.blockHash,
      ),
    ];
    error.stack = undefined;
    throw error;
  }
  if (transaction.blockHash === undefined) {
    const error = new RpcProviderError(
      "'transaction.blockHash' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getBlockText(
        blockIdentifier === "number"
          ? hexToNumber(transaction.blockNumber)
          : transaction.blockHash,
      ),
    ];
    error.stack = undefined;
    throw error;
  }
  if (transaction.from === undefined) {
    const error = new RpcProviderError(
      "'transaction.from' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getBlockText(
        blockIdentifier === "number"
          ? hexToNumber(transaction.blockNumber)
          : transaction.blockHash,
      ),
    ];
    error.stack = undefined;
    throw error;
  }
  if (transaction.to === undefined) {
    const error = new RpcProviderError(
      "'transaction.to' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getBlockText(
        blockIdentifier === "number"
          ? hexToNumber(transaction.blockNumber)
          : transaction.blockHash,
      ),
    ];
    error.stack = undefined;
    throw error;
  }

  // non-required properties
  if (transaction.input === undefined) {
    transaction.input = "0x";
  }
  if (transaction.value === undefined) {
    transaction.value = "0x0";
  }
  if (transaction.nonce === undefined) {
    transaction.nonce = "0x0";
  }
  if (transaction.r === undefined) {
    transaction.r = "0x0";
  }
  if (transaction.s === undefined) {
    transaction.s = "0x0";
  }
  if (transaction.v === undefined) {
    transaction.v = "0x0";
  }
  if (transaction.type === undefined) {
    // @ts-ignore
    transaction.type = "0x0";
  }
  if (transaction.gas === undefined) {
    transaction.gas = "0x0";
  }

  if (hexToBigInt(transaction.blockNumber) > PG_BIGINT_MAX) {
    const error = new RpcProviderError(
      `'transaction.blockNumber' is larger than the maximum allowed value. ${hexToBigInt(transaction.blockNumber)} > ${PG_BIGINT_MAX}`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getBlockText(
        blockIdentifier === "number"
          ? hexToNumber(transaction.blockNumber)
          : transaction.blockHash,
      ),
    ];
    error.stack = undefined;
    throw error;
  }
  if (hexToBigInt(transaction.transactionIndex) > BigInt(PG_INTEGER_MAX)) {
    const error = new RpcProviderError(
      `'transaction.transactionIndex' is larger than the maximum allowed value. ${hexToBigInt(transaction.transactionIndex)} > ${PG_INTEGER_MAX}`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getBlockText(
        blockIdentifier === "number"
          ? hexToNumber(transaction.blockNumber)
          : transaction.blockHash,
      ),
    ];
    error.stack = undefined;
    throw error;
  }
  if (hexToBigInt(transaction.nonce) > BigInt(PG_INTEGER_MAX)) {
    const error = new RpcProviderError(
      `'transaction.nonce' is larger than the maximum allowed value. ${hexToBigInt(transaction.nonce)} > ${PG_INTEGER_MAX}`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getBlockText(
        blockIdentifier === "number"
          ? hexToNumber(transaction.blockNumber)
          : transaction.blockHash,
      ),
    ];
    error.stack = undefined;
    throw error;
  }

  return transaction;
};

/**
 * Validate required log properties and set properties.
 *
 * Required properties:
 * - blockNumber
 * - logIndex
 * - blockHash
 * - address
 * - topics
 * - data
 * - transactionHash
 * - transactionIndex
 *
 * Non-required properties:
 * - removed
 */
export const standardizeLog = (
  log: SyncLog,
  blockIdentifier: number | Hash,
): SyncLog => {
  // required properties
  if (log.blockNumber === undefined) {
    const error = new RpcProviderError(
      "'log.blockNumber' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getLogsText(blockIdentifier),
    ];
    error.stack = undefined;
    throw error;
  }
  if (log.logIndex === undefined) {
    const error = new RpcProviderError("'log.logIndex' is a required property");
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getLogsText(blockIdentifier),
    ];
    error.stack = undefined;
    throw error;
  }
  if (log.blockHash === undefined) {
    const error = new RpcProviderError(
      "'log.blockHash' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getLogsText(blockIdentifier),
    ];
    error.stack = undefined;
    throw error;
  }
  if (log.address === undefined) {
    const error = new RpcProviderError("'log.address' is a required property");
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getLogsText(blockIdentifier),
    ];
    error.stack = undefined;
    throw error;
  }
  if (log.topics === undefined) {
    const error = new RpcProviderError("'log.topics' is a required property");
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getLogsText(blockIdentifier),
    ];
    error.stack = undefined;
    throw error;
  }
  if (log.data === undefined) {
    const error = new RpcProviderError("'log.data' is a required property");
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getLogsText(blockIdentifier),
    ];
    error.stack = undefined;
    throw error;
  }
  if (log.transactionHash === undefined) {
    log.transactionHash = zeroHash;
  }
  if (log.transactionIndex === undefined) {
    log.transactionIndex = "0x0";
  }

  // non-required properties
  if (log.removed === undefined) {
    log.removed = false;
  }

  if (hexToBigInt(log.blockNumber) > PG_BIGINT_MAX) {
    const error = new RpcProviderError(
      `'log.blockNumber' is larger than the maximum allowed value. ${hexToBigInt(log.blockNumber)} > ${PG_BIGINT_MAX}`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getLogsText(blockIdentifier),
    ];
    error.stack = undefined;
    throw error;
  }
  if (hexToBigInt(log.transactionIndex) > BigInt(PG_INTEGER_MAX)) {
    const error = new RpcProviderError(
      `'log.transactionIndex' is larger than the maximum allowed value. ${hexToBigInt(log.transactionIndex)} > ${PG_INTEGER_MAX}`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getLogsText(blockIdentifier),
    ];
    error.stack = undefined;
    throw error;
  }
  if (hexToBigInt(log.logIndex) > BigInt(PG_INTEGER_MAX)) {
    const error = new RpcProviderError(
      `'log.logIndex' is larger than the maximum allowed value. ${hexToBigInt(log.logIndex)} > ${PG_INTEGER_MAX}`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      eth_getLogsText(blockIdentifier),
    ];
    error.stack = undefined;
    throw error;
  }

  return log;
};

/**
 * Validate required trace properties and set non-required properties.
 *
 * Required properties:
 * - transactionHash
 * - type
 * - from
 * - input
 *
 * Non-required properties:
 * - gas
 * - gasUsed
 */
export const standardizeTrace = (
  trace: SyncTrace,
  blockIdentifier: number | Hash,
): SyncTrace => {
  // required properties
  if (trace.transactionHash === undefined) {
    const error = new RpcProviderError(
      "'trace.transactionHash' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      debug_traceBlockText(blockIdentifier),
    ];
    error.stack = undefined;
    throw error;
  }
  if (trace.trace.type === undefined) {
    const error = new RpcProviderError("'trace.type' is a required property");
    error.meta = [
      "Please report this error to the RPC operator.",
      debug_traceBlockText(blockIdentifier),
    ];
    error.stack = undefined;
    throw error;
  }
  if (trace.trace.from === undefined) {
    const error = new RpcProviderError("'trace.from' is a required property");
    error.meta = [
      "Please report this error to the RPC operator.",
      debug_traceBlockText(blockIdentifier),
    ];
    error.stack = undefined;
    throw error;
  }
  if (trace.trace.input === undefined) {
    const error = new RpcProviderError("'trace.input' is a required property");
    error.meta = [
      "Please report this error to the RPC operator.",
      debug_traceBlockText(blockIdentifier),
    ];
    error.stack = undefined;
    throw error;
  }

  // non-required properties
  if (trace.trace.gas === undefined) {
    trace.trace.gas = "0x0";
  }
  if (trace.trace.gasUsed === undefined) {
    trace.trace.gasUsed = "0x0";
  }

  // Note: All INTEGER and BIGINT `trace` columns are generated, not derived from
  // RPC responses.

  return trace;
};

/**
 * Validate required transaction receipt properties and set non-required properties.
 *
 * Required properties:
 * - blockHash
 * - blockNumber
 * - transactionHash
 * - transactionIndex
 * - from
 * - to
 * - status
 *
 * Non-required properties:
 * - logs
 * - logsBloom
 * - gasUsed
 * - cumulativeGasUsed
 * - effectiveGasPrice
 * - root
 * - type
 */
export const standardizeTransactionReceipt = (
  receipt: SyncTransactionReceipt,
  method: "eth_getBlockReceipts" | "eth_getTransactionReceipt",
): SyncTransactionReceipt => {
  // required properties
  if (receipt.blockHash === undefined) {
    const error = new RpcProviderError(
      "'receipt.blockHash' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      method === "eth_getBlockReceipts"
        ? eth_getBlockReceiptsText(receipt.blockHash)
        : eth_getTransactionReceiptText(receipt.transactionHash),
    ];
    error.stack = undefined;
    throw error;
  }
  if (receipt.blockNumber === undefined) {
    const error = new RpcProviderError(
      "'receipt.blockNumber' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      method === "eth_getBlockReceipts"
        ? eth_getBlockReceiptsText(receipt.blockHash)
        : eth_getTransactionReceiptText(receipt.transactionHash),
    ];
    error.stack = undefined;
    throw error;
  }
  if (receipt.transactionHash === undefined) {
    const error = new RpcProviderError(
      "'receipt.transactionHash' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      method === "eth_getBlockReceipts"
        ? eth_getBlockReceiptsText(receipt.blockHash)
        : eth_getTransactionReceiptText(receipt.transactionHash),
    ];
    error.stack = undefined;
    throw error;
  }
  if (receipt.transactionIndex === undefined) {
    const error = new RpcProviderError(
      "'receipt.transactionIndex' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      method === "eth_getBlockReceipts"
        ? eth_getBlockReceiptsText(receipt.blockHash)
        : eth_getTransactionReceiptText(receipt.transactionHash),
    ];
    error.stack = undefined;
    throw error;
  }
  if (receipt.from === undefined) {
    const error = new RpcProviderError("'receipt.from' is a required property");
    error.meta = [
      "Please report this error to the RPC operator.",
      method === "eth_getBlockReceipts"
        ? eth_getBlockReceiptsText(receipt.blockHash)
        : eth_getTransactionReceiptText(receipt.transactionHash),
    ];
    error.stack = undefined;
    throw error;
  }
  if (receipt.to === undefined) {
    const error = new RpcProviderError("'receipt.to' is a required property");
    error.meta = [
      "Please report this error to the RPC operator.",
      method === "eth_getBlockReceipts"
        ? eth_getBlockReceiptsText(receipt.blockHash)
        : eth_getTransactionReceiptText(receipt.transactionHash),
    ];
    error.stack = undefined;
    throw error;
  }
  if (receipt.status === undefined) {
    const error = new RpcProviderError(
      "'receipt.status' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      method === "eth_getBlockReceipts"
        ? eth_getBlockReceiptsText(receipt.blockHash)
        : eth_getTransactionReceiptText(receipt.transactionHash),
    ];
    error.stack = undefined;
    throw error;
  }

  // non-required properties
  if (receipt.logs === undefined) {
    receipt.logs = [];
  }
  if (receipt.logsBloom === undefined) {
    receipt.logsBloom = zeroLogsBloom;
  }
  if (receipt.gasUsed === undefined) {
    receipt.gasUsed = "0x0";
  }
  if (receipt.cumulativeGasUsed === undefined) {
    receipt.cumulativeGasUsed = "0x0";
  }
  if (receipt.effectiveGasPrice === undefined) {
    receipt.effectiveGasPrice = "0x0";
  }
  if (receipt.root === undefined) {
    receipt.root = zeroHash;
  }
  if (receipt.type === undefined) {
    // @ts-ignore
    receipt.type = "0x0";
  }

  if (hexToBigInt(receipt.blockNumber) > PG_BIGINT_MAX) {
    const error = new RpcProviderError(
      `'receipt.blockNumber' is larger than the maximum allowed value. ${hexToBigInt(receipt.blockNumber)} > ${PG_BIGINT_MAX}`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      method === "eth_getBlockReceipts"
        ? eth_getBlockReceiptsText(receipt.blockHash)
        : eth_getTransactionReceiptText(receipt.transactionHash),
    ];
    error.stack = undefined;
    throw error;
  }
  if (hexToBigInt(receipt.transactionIndex) > BigInt(PG_INTEGER_MAX)) {
    const error = new RpcProviderError(
      `'receipt.transactionIndex' is larger than the maximum allowed value. ${hexToBigInt(receipt.transactionIndex)} > ${PG_INTEGER_MAX}`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      method === "eth_getBlockReceipts"
        ? eth_getBlockReceiptsText(receipt.blockHash)
        : eth_getTransactionReceiptText(receipt.transactionHash),
    ];
    error.stack = undefined;
    throw error;
  }

  return receipt;
};

function eth_getLogsText(numberOrHash: Hex | number): string {
  if (typeof numberOrHash === "number") {
    return `Logs request: ${JSON.stringify(
      {
        method: "eth_getLogs",
        params: [
          {
            fromBlock: toHex(numberOrHash),
            toBlock: toHex(numberOrHash),
          },
        ],
      },
      null,
      2,
    )}`;
  }

  return `Logs request: ${JSON.stringify(
    {
      method: "eth_getLogs",
      params: [{ blockHash: numberOrHash }],
    },
    null,
    2,
  )}`;
}

function eth_getBlockText(numberOrHash: Hex | number): string {
  if (typeof numberOrHash === "number") {
    return `Block request: ${JSON.stringify(
      {
        method: "eth_getBlockByNumber",
        params: [toHex(numberOrHash), true],
      },
      null,
      2,
    )}`;
  }

  return `Block request: ${JSON.stringify(
    {
      method: "eth_getBlockByHash",
      params: [numberOrHash, true],
    },
    null,
    2,
  )}`;
}

function eth_subscribeNewHeadsText(): string {
  return `Block request: ${JSON.stringify(
    {
      method: "eth_subscribe",
      params: ["newHeads"],
    },
    null,
    2,
  )}`;
}

function eth_getBlockReceiptsText(hash: Hex): string {
  return `Receipts request: ${JSON.stringify(
    {
      method: "eth_getBlockReceipts",
      params: [hash],
    },
    null,
    2,
  )}`;
}

function eth_getTransactionReceiptText(hash: Hex): string {
  return `Receipt request: ${JSON.stringify(
    {
      method: "eth_getTransactionReceipt",
      params: [hash],
    },
    null,
    2,
  )}`;
}

function debug_traceBlockText(numberOrHash: Hex | number): string {
  if (typeof numberOrHash === "number") {
    return `Traces request: ${JSON.stringify(
      {
        method: "debug_traceBlockByNumber",
        params: [toHex(numberOrHash), { tracer: "callTracer" }],
      },
      null,
      2,
    )}`;
  }

  return `Traces request: ${JSON.stringify(
    {
      method: "debug_traceBlockByHash",
      params: [numberOrHash, { tracer: "callTracer" }],
    },
    null,
    2,
  )}`;
}
