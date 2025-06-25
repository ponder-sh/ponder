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
import {
  type Address,
  BlockNotFoundError,
  type Hash,
  type Hex,
  type LogTopic,
  TransactionReceiptNotFoundError,
  numberToHex,
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
      return standardizeBlock(_block as SyncBlock);
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
      return standardizeBlock(_block as SyncBlock);
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
      .then((l) => {
        if (l === null || l === undefined) {
          throw new Error("Received invalid empty eth_getLogs response.");
        }

        return (l as SyncLog[]).map(standardizeLog);
      });
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
      return standardizeTransactionReceipt(receipt as SyncTransactionReceipt);
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
    .then((receipts) => {
      if (receipts === null || receipts === undefined) {
        throw new Error(
          "Received invalid empty eth_getBlockReceipts response.",
        );
      }

      return (receipts as unknown as SyncTransactionReceipt[]).map(
        standardizeTransactionReceipt,
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
): Promise<SyncTrace[]> =>
  rpc
    .request({
      method: "debug_traceBlockByHash",
      params: [hash, { tracer: "callTracer" }],
    })
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
export const validateTransactionsAndBlock = (block: SyncBlock) => {
  const transactionIds = new Set<Hex>();
  for (const transaction of block.transactions) {
    if (block.hash !== transaction.blockHash) {
      throw new Error(
        `Detected inconsistent RPC responses. 'transaction.blockHash' ${transaction.blockHash} does not match 'block.hash' ${block.hash}`,
      );
    }

    if (block.number !== transaction.blockNumber) {
      throw new Error(
        `Detected inconsistent RPC responses. 'transaction.blockNumber' ${transaction.blockNumber} does not match 'block.number' ${block.number}`,
      );
    }

    if (transactionIds.has(transaction.transactionIndex)) {
      throw new Error(
        `Detected invalid eth_getBlock response. Duplicate transaction index ${transaction.transactionIndex} for block ${block.hash}.`,
      );
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
export const validateLogsAndBlock = (logs: SyncLog[], block: SyncBlock) => {
  const logIndexes = new Set<string>();
  const transactionByIndex = new Map<Hex, SyncTransaction>(
    block.transactions.map((transaction) => [
      transaction.transactionIndex,
      transaction,
    ]),
  );
  for (const log of logs) {
    if (block.hash !== log.blockHash) {
      throw new Error(
        `Detected inconsistent RPC responses. 'log.blockHash' ${log.blockHash} does not match 'block.hash' ${block.hash}`,
      );
    }

    if (block.number !== log.blockNumber) {
      throw new Error(
        `Detected inconsistent RPC responses. 'log.blockNumber' ${log.blockNumber} does not match 'block.number' ${block.number}`,
      );
    }

    if (log.transactionHash !== zeroHash) {
      const transaction = transactionByIndex.get(log.transactionIndex);
      if (transaction === undefined) {
        throw new Error(
          `Detected inconsistent RPC responses. 'log.transactionIndex' ${log.transactionIndex} not found in 'block.transactions' for block ${block.hash}`,
        );
      } else if (transaction.hash !== log.transactionHash) {
        throw new Error(
          `Detected inconsistent RPC responses. 'log.transactionHash' ${log.transactionHash} does not match 'transaction.hash' ${transaction.hash} for block ${block.hash}`,
        );
      }
    }

    if (logIndexes.has(log.logIndex)) {
      throw new Error(
        `Detected invalid eth_getLogs response. Duplicate log index ${log.logIndex} for block ${log.blockHash}.`,
      );
    } else {
      logIndexes.add(log.logIndex);
    }

    if (block.logsBloom !== zeroLogsBloom && logs.length === 0) {
      throw new Error(
        "Detected invalid eth_getLogs response. `block.logsBloom` is not empty but zero logs were returned.",
      );
    }
  }
};

/**
 * Validate that the traces are consistent with the block.
 */
export const validateTracesAndBlock = (
  traces: SyncTrace[],
  block: SyncBlock,
) => {
  const traceIds = new Set<string>();
  const transactionHashes = new Set(block.transactions.map((t) => t.hash));
  for (const trace of traces) {
    if (transactionHashes.has(trace.transactionHash) === false) {
      throw new Error(
        `Detected inconsistent RPC responses. 'trace.transactionHash' ${trace.transactionHash} not found in 'block.transactions' ${block.hash}`,
      );
    }

    const id = `${trace.transactionHash}-${trace.trace.index}`;
    if (traceIds.has(id)) {
      throw new Error(
        `Detected invalid debug_traceBlockByHash response. Duplicate trace index ${trace.trace.index} for transaction ${trace.transactionHash}.`,
      );
    } else {
      traceIds.add(id);
    }
  }

  // Use the fact that any transaction produces a trace to validate.
  if (block.transactions.length !== 0 && traces.length === 0) {
    throw new Error(
      "Detected invalid debug_traceBlock response. `block.transactions` is not empty but zero traces were returned.",
    );
  }
};

/**
 * Validate that the receipts are consistent with the block.
 */
export const validateReceiptsAndBlock = (
  receipts: SyncTransactionReceipt[],
  block: SyncBlock,
  method: "eth_getBlockReceipts" | "eth_getTransactionReceipt",
) => {
  const receiptIds = new Set<string>();

  for (const receipt of receipts) {
    const id = receipt.transactionHash;
    if (receiptIds.has(id)) {
      throw new Error(
        `Detected invalid eth_getBlockReceipts response. Duplicate receipt for transaction ${receipt.transactionHash}.`,
      );
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

  for (const receipt of receipts) {
    if (block.hash !== receipt.blockHash) {
      throw new Error(
        `Detected inconsistent RPC responses. 'receipt.blockHash' ${receipt.blockHash} does not match 'block.hash' ${block.hash}`,
      );
    }

    if (block.number !== receipt.blockNumber) {
      throw new Error(
        `Detected inconsistent RPC responses. 'receipt.blockNumber' ${receipt.blockNumber} does not match 'block.number' ${block.number}`,
      );
    }

    const transaction = transactionByIndex.get(receipt.transactionIndex);
    if (transaction === undefined) {
      throw new Error(
        `Detected inconsistent RPC responses. 'receipt.transactionIndex' ${receipt.transactionIndex} not found in 'block.transactions' for block ${block.hash}`,
      );
    } else if (transaction.hash !== receipt.transactionHash) {
      throw new Error(
        `Detected inconsistent RPC responses. 'receipt.transactionHash' ${receipt.transactionHash} does not match 'transaction.hash' ${transaction.hash} for block ${block.hash}`,
      );
    }
  }

  if (
    method === "eth_getBlockReceipts" &&
    block.transactions.length !== receipts.length
  ) {
    throw new Error(
      `Detected inconsistent RPC responses. 'block.transactions' length ${block.transactions.length} does not match 'receipts' length ${receipts.length} for block ${block.hash}`,
    );
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
  isBlockHeader = false,
): block extends SyncBlock ? SyncBlock : SyncBlockHeader => {
  // required properties
  if (block.hash === undefined) {
    throw new Error("'block.hash' is a required property");
  }
  if (block.number === undefined) {
    throw new Error("'block.number' is a required property");
  }
  if (block.timestamp === undefined) {
    throw new Error("'block.timestamp' is a required property");
  }
  if (block.logsBloom === undefined) {
    throw new Error("'block.logsBloom' is a required property");
  }
  if (block.parentHash === undefined) {
    throw new Error("'block.parentHash' is a required property");
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

  // Note: block headers for some providers may contain transactions hashes,
  // but Ponder coerces the transactions property to undefined.

  if (isBlockHeader) {
    block.transactions = undefined;

    return block as block extends SyncBlock ? SyncBlock : SyncBlockHeader;
  } else {
    if (block.transactions === undefined) {
      throw new Error("'block.transactions' is a required property");
    }

    block.transactions = (block as SyncBlock).transactions.map(
      standardizeTransaction,
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
): SyncTransaction => {
  // required properties
  if (transaction.hash === undefined) {
    throw new Error("'transaction.hash' is a required property");
  }
  if (transaction.transactionIndex === undefined) {
    throw new Error("'transaction.transactionIndex' is a required property");
  }
  if (transaction.blockNumber === undefined) {
    throw new Error("'transaction.blockNumber' is a required property");
  }
  if (transaction.blockHash === undefined) {
    throw new Error("'transaction.blockHash' is a required property");
  }
  if (transaction.from === undefined) {
    throw new Error("'transaction.from' is a required property");
  }
  if (transaction.to === undefined) {
    throw new Error("'transaction.to' is a required property");
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
export const standardizeLog = (log: SyncLog): SyncLog => {
  // required properties
  if (log.blockNumber === undefined) {
    throw new Error("'log.blockNumber' is a required property");
  }
  if (log.logIndex === undefined) {
    throw new Error("'log.logIndex' is a required property");
  }
  if (log.blockHash === undefined) {
    throw new Error("'log.blockHash' is a required property");
  }
  if (log.address === undefined) {
    throw new Error("'log.address' is a required property");
  }
  if (log.topics === undefined) {
    throw new Error("'log.topics' is a required property");
  }
  if (log.data === undefined) {
    throw new Error("'log.data' is a required property");
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
export const standardizeTrace = (trace: SyncTrace): SyncTrace => {
  // required properties
  if (trace.transactionHash === undefined) {
    throw new Error("'trace.transactionHash' is a required property");
  }
  if (trace.trace.type === undefined) {
    throw new Error("'trace.type' is a required property");
  }
  if (trace.trace.from === undefined) {
    throw new Error("'trace.from' is a required property");
  }
  if (trace.trace.input === undefined) {
    throw new Error("'trace.input' is a required property");
  }

  // non-required properties
  if (trace.trace.gas === undefined) {
    trace.trace.gas = "0x0";
  }
  if (trace.trace.gasUsed === undefined) {
    trace.trace.gasUsed = "0x0";
  }

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
): SyncTransactionReceipt => {
  // required properties
  if (receipt.blockHash === undefined) {
    throw new Error("'receipt.blockHash' is a required property");
  }
  if (receipt.blockNumber === undefined) {
    throw new Error("'receipt.blockNumber' is a required property");
  }
  if (receipt.transactionHash === undefined) {
    throw new Error("'receipt.transactionHash' is a required property");
  }
  if (receipt.transactionIndex === undefined) {
    throw new Error("'receipt.transactionIndex' is a required property");
  }
  if (receipt.from === undefined) {
    throw new Error("'receipt.from' is a required property");
  }
  if (receipt.to === undefined) {
    throw new Error("'receipt.to' is a required property");
  }
  if (receipt.status === undefined) {
    throw new Error("'receipt.status' is a required property");
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

  return receipt;
};
