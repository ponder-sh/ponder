import { RpcProviderError } from "@/internal/errors.js";
import type {
  LightBlock,
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/internal/types.js";
import type { RequestParameters, Rpc } from "@/rpc/index.js";
import { zeroLogsBloom } from "@/sync-realtime/bloom.js";
import { PG_BIGINT_MAX, PG_INTEGER_MAX } from "@/utils/pg.js";
import {
  BlockNotFoundError,
  type Hex,
  TransactionReceiptNotFoundError,
  hexToBigInt,
  hexToNumber,
  isHex,
  zeroAddress,
  zeroHash,
} from "viem";

/**
 * Helper function for "eth_getBlockByNumber" request.
 */
export const eth_getBlockByNumber = <
  params extends Extract<
    RequestParameters,
    { method: "eth_getBlockByNumber" }
  >["params"],
>(
  rpc: Rpc,
  params: params,
  context?: Parameters<Rpc["request"]>[1],
): Promise<params[1] extends true ? SyncBlock : LightBlock> =>
  rpc
    .request({ method: "eth_getBlockByNumber", params }, context)
    .then((_block) => {
      if (!_block) {
        let blockNumber: bigint;
        if (isHex(params[0])) {
          blockNumber = hexToBigInt(params[0]);
        } else {
          // @ts-ignore `BlockNotFoundError` expects a bigint, but it also just passes
          // the `blockNumber` directly to the error message, so breaking the type constraint is fine.
          blockNumber = params[0];
        }

        throw new BlockNotFoundError({ blockNumber });
      }
      return standardizeBlock(_block as SyncBlock, {
        method: "eth_getBlockByNumber",
        params,
      });
    });

/**
 * Helper function for "eth_getBlockByHash" request.
 */
export const eth_getBlockByHash = <
  params extends Extract<
    RequestParameters,
    { method: "eth_getBlockByHash" }
  >["params"],
>(
  rpc: Rpc,
  params: params,
  context?: Parameters<Rpc["request"]>[1],
): Promise<params[1] extends true ? SyncBlock : LightBlock> =>
  rpc
    .request({ method: "eth_getBlockByHash", params }, context)
    .then((_block) => {
      if (!_block) throw new BlockNotFoundError({ blockHash: params[0] });
      return standardizeBlock(_block as SyncBlock, {
        method: "eth_getBlockByHash",
        params,
      });
    });

/**
 * Helper function for "eth_getLogs" rpc request.
 * Handles different error types and retries the request if applicable.
 */
export const eth_getLogs = async (
  rpc: Rpc,
  params: Extract<RequestParameters, { method: "eth_getLogs" }>["params"],
  context?: Parameters<Rpc["request"]>[1],
): Promise<SyncLog[]> => {
  const request: Extract<RequestParameters, { method: "eth_getLogs" }> = {
    method: "eth_getLogs",
    params,
  };

  return rpc.request(request, context).then((logs) => {
    if (logs === null || logs === undefined) {
      throw new Error("Received invalid empty eth_getLogs response.");
    }

    return standardizeLogs(logs as SyncLog[], request);
  });
};

/**
 * Helper function for "eth_getTransactionReceipt" request.
 */
export const eth_getTransactionReceipt = (
  rpc: Rpc,
  params: Extract<
    RequestParameters,
    { method: "eth_getTransactionReceipt" }
  >["params"],
  context?: Parameters<Rpc["request"]>[1],
): Promise<SyncTransactionReceipt> =>
  rpc
    .request({ method: "eth_getTransactionReceipt", params }, context)
    .then((receipt) => {
      if (!receipt) {
        throw new TransactionReceiptNotFoundError({
          hash: params[0],
        });
      }

      return standardizeTransactionReceipts([receipt], {
        method: "eth_getTransactionReceipt",
        params,
      })[0]!;
    });

/**
 * Helper function for "eth_getBlockReceipts" request.
 */
export const eth_getBlockReceipts = (
  rpc: Rpc,
  params: Extract<
    RequestParameters,
    { method: "eth_getBlockReceipts" }
  >["params"],
  context?: Parameters<Rpc["request"]>[1],
): Promise<SyncTransactionReceipt[]> =>
  rpc
    .request({ method: "eth_getBlockReceipts", params }, context)
    .then((receipts) => {
      if (receipts === null || receipts === undefined) {
        throw new Error(
          "Received invalid empty eth_getBlockReceipts response.",
        );
      }

      return standardizeTransactionReceipts(receipts, {
        method: "eth_getBlockReceipts",
        params,
      });
    });

/**
 * Helper function for "debug_traceBlockByNumber" request.
 */
export const debug_traceBlockByNumber = (
  rpc: Rpc,
  params: Extract<
    RequestParameters,
    { method: "debug_traceBlockByNumber" }
  >["params"],
  context?: Parameters<Rpc["request"]>[1],
): Promise<SyncTrace[]> =>
  rpc
    .request({ method: "debug_traceBlockByNumber", params }, context)
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

      return result.map((trace) =>
        standardizeTrace(trace, {
          method: "debug_traceBlockByNumber",
          params,
        }),
      );
    });

/**
 * Helper function for "debug_traceBlockByHash" request.
 */
export const debug_traceBlockByHash = (
  rpc: Rpc,
  params: Extract<
    RequestParameters,
    { method: "debug_traceBlockByHash" }
  >["params"],
  context?: Parameters<Rpc["request"]>[1],
): Promise<SyncTrace[]> =>
  rpc
    .request({ method: "debug_traceBlockByHash", params }, context)
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

      return result.map((trace) =>
        standardizeTrace(trace, {
          method: "debug_traceBlockByHash",
          params,
        }),
      );
    });

/**
 * Validate that the transactions are consistent with the block.
 */
export const validateTransactionsAndBlock = (
  block: SyncBlock,
  request: Extract<
    RequestParameters,
    { method: "eth_getBlockByNumber" | "eth_getBlockByHash" }
  >,
) => {
  for (const [index, transaction] of block.transactions.entries()) {
    if (block.hash !== transaction.blockHash) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The transaction at index ${index} of the 'block.transactions' array has a 'transaction.blockHash' of ${transaction.blockHash}, but the block itself has a 'block.hash' of ${block.hash}.`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
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
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
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
  logsRequest: Extract<RequestParameters, { method: "eth_getLogs" }>,
  blockRequest: Extract<
    RequestParameters,
    { method: "eth_getBlockByNumber" | "eth_getBlockByHash" }
  >,
) => {
  if (block.logsBloom !== zeroLogsBloom && logs.length === 0) {
    const error = new RpcProviderError(
      `Inconsistent RPC response data. The logs array has length 0, but the associated block has a non-empty 'block.logsBloom'.`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      requestText(blockRequest),
      requestText(logsRequest),
    ];
    error.stack = undefined;
    throw error;
  }

  const transactionByIndex = new Map<Hex, SyncTransaction>(
    block.transactions.map((transaction) => [
      transaction.transactionIndex,
      transaction,
    ]),
  );

  for (const log of logs) {
    if (block.hash !== log.blockHash) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The log with 'logIndex' ${log.logIndex} (${hexToNumber(log.logIndex)}) has a 'log.blockHash' of ${log.blockHash}, but the associated block has a 'block.hash' of ${block.hash}.`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(blockRequest),
        requestText(logsRequest),
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
        requestText(blockRequest),
        requestText(logsRequest),
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
          requestText(blockRequest),
          requestText(logsRequest),
        ];
        error.stack = undefined;
        throw error;
      } else if (transaction.hash !== log.transactionHash) {
        const error = new RpcProviderError(
          `Inconsistent RPC response data. The log with 'logIndex' ${log.logIndex} (${hexToNumber(log.logIndex)}) matches a transaction in the associated 'block.transactions' array by 'transactionIndex' ${log.transactionIndex} (${hexToNumber(log.transactionIndex)}), but the log has a 'log.transactionHash' of ${log.transactionHash} while the transaction has a 'transaction.hash' of ${transaction.hash}.`,
        );
        error.meta = [
          "Please report this error to the RPC operator.",
          requestText(blockRequest),
          requestText(logsRequest),
        ];
        error.stack = undefined;
        throw error;
      }
    }
  }
};

/**
 * Validate that the traces are consistent with the block.
 */
export const validateTracesAndBlock = (
  traces: SyncTrace[],
  block: SyncBlock,
  tracesRequest: Extract<
    RequestParameters,
    { method: "debug_traceBlockByNumber" | "debug_traceBlockByHash" }
  >,
  blockRequest: Extract<
    RequestParameters,
    { method: "eth_getBlockByNumber" | "eth_getBlockByHash" }
  >,
) => {
  const transactionHashes = new Set(block.transactions.map((t) => t.hash));
  for (const [index, trace] of traces.entries()) {
    if (transactionHashes.has(trace.transactionHash) === false) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The top-level trace at array index ${index} has a 'transactionHash' of ${trace.transactionHash}, but the associated 'block.transactions' array does not contain a transaction matching that hash.`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(blockRequest),
        requestText(tracesRequest),
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
      requestText(blockRequest),
      requestText(tracesRequest),
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
  receiptsRequest: Extract<
    RequestParameters,
    { method: "eth_getBlockReceipts" | "eth_getTransactionReceipt" }
  >,
  blockRequest: Extract<
    RequestParameters,
    { method: "eth_getBlockByNumber" | "eth_getBlockByHash" }
  >,
) => {
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
        requestText(blockRequest),
        requestText(receiptsRequest),
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
        requestText(blockRequest),
        requestText(receiptsRequest),
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
        requestText(blockRequest),
        requestText(receiptsRequest),
      ];
      error.stack = undefined;
      throw error;
    } else if (transaction.hash !== receipt.transactionHash) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The receipt at array index ${index} matches a transaction in the associated 'block.transactions' array by 'transactionIndex' ${receipt.transactionIndex} (${hexToNumber(receipt.transactionIndex)}), but the receipt has a 'receipt.transactionHash' of ${receipt.transactionHash} while the transaction has a 'transaction.hash' of ${transaction.hash}.`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(blockRequest),
        requestText(receiptsRequest),
      ];
      error.stack = undefined;
      throw error;
    }
  }

  if (
    receiptsRequest.method === "eth_getBlockReceipts" &&
    block.transactions.length !== receipts.length
  ) {
    const error = new RpcProviderError(
      `Inconsistent RPC response data. The receipts array has length ${receipts.length}, but the associated 'block.transactions' array has length ${block.transactions.length}.`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      requestText(blockRequest),
      requestText(receiptsRequest),
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
  request:
    | Extract<
        RequestParameters,
        { method: "eth_getBlockByNumber" | "eth_getBlockByHash" }
      >
    | { method: "eth_subscribe"; params: ["newHeads"] },
): block extends SyncBlock ? SyncBlock : SyncBlockHeader => {
  // required properties
  if (block.hash === undefined) {
    const error = new RpcProviderError(
      "Invalid RPC response: 'block.hash' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      requestText(request),
    ];
    error.stack = undefined;
    throw error;
  }
  if (block.number === undefined) {
    const error = new RpcProviderError(
      "Invalid RPC response: 'block.number' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      requestText(request),
    ];
    error.stack = undefined;
    throw error;
  }
  if (block.timestamp === undefined) {
    const error = new RpcProviderError(
      "Invalid RPC response: 'block.timestamp' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      requestText(request),
    ];
    error.stack = undefined;
    throw error;
  }
  if (block.logsBloom === undefined) {
    const error = new RpcProviderError(
      "Invalid RPC response: 'block.logsBloom' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      requestText(request),
    ];
    error.stack = undefined;
    throw error;
  }
  if (block.parentHash === undefined) {
    const error = new RpcProviderError(
      "Invalid RPC response: 'block.parentHash' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      requestText(request),
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
      `Invalid RPC response: 'block.number' (${hexToBigInt(block.number)}) is larger than the maximum allowed value (${PG_BIGINT_MAX}).`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      requestText(request),
    ];
    error.stack = undefined;
    throw error;
  }
  if (hexToBigInt(block.timestamp) > PG_BIGINT_MAX) {
    const error = new RpcProviderError(
      `Invalid RPC response: 'block.timestamp' (${hexToBigInt(block.timestamp)}) is larger than the maximum allowed value (${PG_BIGINT_MAX}).`,
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      requestText(request),
    ];
    error.stack = undefined;
    throw error;
  }

  // Note: block headers for some providers may contain transactions hashes,
  // but Ponder coerces the transactions property to undefined.

  if (request.method === "eth_subscribe" || request.params[1] === false) {
    block.transactions = undefined;

    return block as block extends SyncBlock ? SyncBlock : SyncBlockHeader;
  } else {
    if (block.transactions === undefined) {
      throw new Error(
        "Invalid RPC response: 'block.transactions' is a required property",
      );
    }

    block.transactions = standardizeTransactions(
      (block as SyncBlock).transactions,
      request,
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
export const standardizeTransactions = (
  transactions: SyncTransaction[],
  request: Extract<
    RequestParameters,
    { method: "eth_getBlockByNumber" | "eth_getBlockByHash" }
  >,
): SyncTransaction[] => {
  const transactionIds = new Set<Hex>();

  for (const transaction of transactions) {
    if (transactionIds.has(transaction.transactionIndex)) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The 'block.transactions' array contains two objects with a 'transactionIndex' of ${transaction.transactionIndex} (${hexToNumber(transaction.transactionIndex)}).`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    } else {
      transactionIds.add(transaction.transactionIndex);
    }

    // required properties
    if (transaction.hash === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'transaction.hash' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (transaction.transactionIndex === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'transaction.transactionIndex' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (transaction.blockNumber === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'transaction.blockNumber' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (transaction.blockHash === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'transaction.blockHash' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (transaction.from === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'transaction.from' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }

    // Note: `to` is a required property but can be coerced to `null`.
    if (transaction.to === undefined) {
      transaction.to = null;
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
        `Invalid RPC response: 'transaction.blockNumber' (${hexToBigInt(transaction.blockNumber)}) is larger than the maximum allowed value (${PG_BIGINT_MAX}).`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (hexToBigInt(transaction.transactionIndex) > BigInt(PG_INTEGER_MAX)) {
      const error = new RpcProviderError(
        `Invalid RPC response: 'transaction.transactionIndex' (${hexToBigInt(transaction.transactionIndex)}) is larger than the maximum allowed value (${PG_INTEGER_MAX}).`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (hexToBigInt(transaction.nonce) > BigInt(PG_INTEGER_MAX)) {
      const error = new RpcProviderError(
        `Invalid RPC response: 'transaction.nonce' (${hexToBigInt(transaction.nonce)}) is larger than the maximum allowed value (${PG_INTEGER_MAX}).`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
  }
  return transactions;
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
export const standardizeLogs = (
  logs: SyncLog[],
  request: Extract<RequestParameters, { method: "eth_getLogs" }>,
): SyncLog[] => {
  const logIds = new Set<string>();
  for (const log of logs) {
    if (logIds.has(`${log.blockNumber}_${log.logIndex}`)) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The logs array contains two objects with 'blockNumber' ${log.blockNumber} (${hexToNumber(log.blockNumber)}) and 'logIndex' ${log.logIndex} (${hexToNumber(log.logIndex)}).`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];

      console.log(logs);
      error.stack = undefined;
      throw error;
    } else {
      logIds.add(`${log.blockNumber}_${log.logIndex}`);
    }

    // required properties
    if (log.blockNumber === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'log.blockNumber' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (log.logIndex === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'log.logIndex' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (log.blockHash === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'log.blockHash' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (log.address === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'log.address' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (log.topics === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'log.topics' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (log.data === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'log.data' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
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
        `Invalid RPC response: 'log.blockNumber' (${hexToBigInt(log.blockNumber)}) is larger than the maximum allowed value (${PG_BIGINT_MAX}).`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (hexToBigInt(log.transactionIndex) > BigInt(PG_INTEGER_MAX)) {
      const error = new RpcProviderError(
        `Invalid RPC response: 'log.transactionIndex' (${hexToBigInt(log.transactionIndex)}) is larger than the maximum allowed value (${PG_INTEGER_MAX}).`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (hexToBigInt(log.logIndex) > BigInt(PG_INTEGER_MAX)) {
      const error = new RpcProviderError(
        `Invalid RPC response: 'log.logIndex' (${hexToBigInt(log.logIndex)}) is larger than the maximum allowed value (${PG_INTEGER_MAX}).`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
  }

  return logs;
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
  request: Extract<
    RequestParameters,
    { method: "debug_traceBlockByNumber" | "debug_traceBlockByHash" }
  >,
): SyncTrace => {
  // required properties
  if (trace.transactionHash === undefined) {
    const error = new RpcProviderError(
      "Invalid RPC response: 'trace.transactionHash' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      requestText(request),
    ];
    error.stack = undefined;
    throw error;
  }
  if (trace.trace.type === undefined) {
    const error = new RpcProviderError(
      "Invalid RPC response: 'trace.type' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      requestText(request),
    ];
    error.stack = undefined;
    throw error;
  }
  if (trace.trace.from === undefined) {
    const error = new RpcProviderError(
      "Invalid RPC response: 'trace.from' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      requestText(request),
    ];
    error.stack = undefined;
    throw error;
  }
  if (trace.trace.input === undefined) {
    const error = new RpcProviderError(
      "Invalid RPC response: 'trace.input' is a required property",
    );
    error.meta = [
      "Please report this error to the RPC operator.",
      requestText(request),
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
export const standardizeTransactionReceipts = (
  receipts: SyncTransactionReceipt[],
  request: Extract<
    RequestParameters,
    { method: "eth_getBlockReceipts" | "eth_getTransactionReceipt" }
  >,
): SyncTransactionReceipt[] => {
  const receiptIds = new Set<string>();
  for (const receipt of receipts) {
    if (receiptIds.has(receipt.transactionHash)) {
      const error = new RpcProviderError(
        `Inconsistent RPC response data. The receipts array contains two objects with a 'transactionHash' of ${receipt.transactionHash}.`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    } else {
      receiptIds.add(receipt.transactionHash);
    }

    // required properties
    if (receipt.blockHash === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'receipt.blockHash' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (receipt.blockNumber === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'receipt.blockNumber' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (receipt.transactionHash === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'receipt.transactionHash' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (receipt.transactionIndex === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'receipt.transactionIndex' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (receipt.from === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'receipt.from' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (receipt.status === undefined) {
      const error = new RpcProviderError(
        "Invalid RPC response: 'receipt.status' is a required property",
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }

    // Note: `to` is a required property but can be coerced to `null`.
    if (receipt.to === undefined) {
      receipt.to = null;
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
        `Invalid RPC response: 'receipt.blockNumber' (${hexToBigInt(receipt.blockNumber)}) is larger than the maximum allowed value (${PG_BIGINT_MAX}).`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
    if (hexToBigInt(receipt.transactionIndex) > BigInt(PG_INTEGER_MAX)) {
      const error = new RpcProviderError(
        `Invalid RPC response: 'receipt.transactionIndex' (${hexToBigInt(receipt.transactionIndex)}) is larger than the maximum allowed value (${PG_INTEGER_MAX}).`,
      );
      error.meta = [
        "Please report this error to the RPC operator.",
        requestText(request),
      ];
      error.stack = undefined;
      throw error;
    }
  }
  return receipts;
};

function requestText(request: { method: string; params: any[] }): string {
  return `Request: ${JSON.stringify(
    {
      method: request.method,
      params: request.params,
    },
    null,
    2,
  )}`;
}
