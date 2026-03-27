import type {
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/internal/types.js";
import type {
  QueryResponseData,
  ResponseBlock,
  ResponseLog,
  ResponseTrace,
  ResponseTransaction,
} from "@/rpc/query.js";
import { zeroLogsBloom } from "@/sync-realtime/bloom.js";
import type { Hex } from "viem";
import { zeroAddress, zeroHash } from "viem";

/**
 * Map a query API ResponseLog to a SyncLog.
 * Mirrors defaults from `standardizeLogs` in actions.ts.
 */
export function responseLogToSyncLog(log: Partial<ResponseLog>): SyncLog {
  return {
    blockNumber: log.blockNumber!,
    blockHash: log.blockHash!,
    transactionHash: log.transactionHash ?? zeroHash,
    transactionIndex: log.transactionIndex ?? "0x0",
    logIndex: log.logIndex!,
    address: log.address!,
    data: log.data!,
    topics: (log.topics ?? []) as [Hex, ...Hex[]] | [],
    removed: false,
  } as SyncLog;
}

/**
 * Map a query API ResponseTransaction to a SyncTransaction.
 * Mirrors defaults from `standardizeTransactions` in actions.ts.
 */
export function responseTransactionToSyncTransaction(
  tx: Partial<ResponseTransaction>,
): SyncTransaction {
  return {
    hash: tx.hash!,
    nonce: tx.nonce ?? "0x0",
    blockHash: tx.blockHash!,
    blockNumber: tx.blockNumber!,
    transactionIndex: tx.transactionIndex!,
    from: tx.from!,
    to: tx.to ?? null,
    value: tx.value ?? "0x0",
    gas: tx.gas ?? "0x0",
    gasPrice: tx.gasPrice ?? "0x0",
    input: tx.input ?? "0x",
    maxFeePerGas: tx.maxFeePerGas,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    type: tx.type ?? "0x0",
    blobVersionedHashes: tx.blobVersionedHashes,
    maxFeePerBlobGas: tx.maxFeePerBlobGas,
    accessList: tx.accessList ?? undefined,
    authorizationList: tx.authorizationList ?? undefined,
    chainId: tx.chainId ?? undefined,
    r: tx.r ?? "0x0",
    s: tx.s ?? "0x0",
    v: tx.v ?? "0x0",
    yParity: tx.yParity ?? undefined,
  } as SyncTransaction;
}

/**
 * Map a query API ResponseBlock to a SyncBlock.
 * Mirrors defaults from `standardizeBlock` in actions.ts.
 *
 * The query API returns blocks and transactions as separate arrays,
 * so transactions for this block must be passed in separately.
 */
export function responseBlockToSyncBlock(
  block: Partial<ResponseBlock>,
  transactions: SyncTransaction[],
): SyncBlock {
  return {
    hash: block.hash!,
    number: block.number!,
    parentHash: block.parentHash!,
    timestamp: block.timestamp!,
    logsBloom: block.logsBloom ?? ("0x" as Hex),
    miner: block.miner ?? zeroAddress,
    gasUsed: block.gasUsed ?? "0x0",
    gasLimit: block.gasLimit ?? "0x0",
    baseFeePerGas: block.baseFeePerGas ?? "0x0",
    nonce: block.nonce ?? "0x0",
    mixHash: block.mixHash ?? zeroHash,
    stateRoot: block.stateRoot ?? zeroHash,
    transactionsRoot: block.transactionsRoot ?? zeroHash,
    receiptsRoot: block.receiptsRoot ?? zeroHash,
    sha3Uncles: block.sha3Uncles ?? zeroHash,
    size: block.size ?? "0x0",
    difficulty: block.difficulty ?? "0x0",
    totalDifficulty: block.totalDifficulty ?? "0x0",
    extraData: block.extraData ?? "0x",
    transactions,
    // Fields that may not be present in the query API response
    uncles: [],
    sealFields: [],
    withdrawals: undefined,
    withdrawalsRoot: block.withdrawalsRoot,
    blobGasUsed: block.blobGasUsed,
    excessBlobGas: block.excessBlobGas,
    parentBeaconBlockRoot: block.parentBeaconBlockRoot ?? undefined,
  } as unknown as SyncBlock;
}

/**
 * Map a query API ResponseTrace to a SyncTrace.
 * Mirrors the structure expected by `standardizeTrace` in actions.ts.
 *
 * SyncTrace is: { trace: CallFrame & { index, subcalls }, transactionHash }
 */
export function responseTraceToSyncTrace(
  trace: Partial<ResponseTrace>,
): SyncTrace {
  return {
    transactionHash: trace.transactionHash!,
    trace: {
      type: (trace.type?.toUpperCase() ?? "CALL") as
        | "CALL"
        | "CALLCODE"
        | "DELEGATECALL"
        | "STATICCALL"
        | "CREATE"
        | "CREATE2"
        | "SELFDESTRUCT",
      from: trace.from!,
      to: trace.to,
      gas: trace.gas ?? "0x0",
      gasUsed: trace.gasUsed ?? "0x0",
      input: trace.input ?? "0x",
      output: trace.output,
      error: trace.error || undefined,
      revertReason: trace.revertReason ?? undefined,
      value: trace.value,
      index: trace.traceIndex ? Number.parseInt(trace.traceIndex, 16) : 0,
      subcalls: trace.childIndexes?.length ?? 0,
    },
  } as SyncTrace;
}

/**
 * Extract receipt fields from a query API ResponseTransaction into a
 * SyncTransactionReceipt. The query API embeds receipt data directly
 * on the transaction response, so no separate receipt fetch is needed.
 */
export function responseTransactionToSyncTransactionReceipt(
  tx: Partial<ResponseTransaction>,
): SyncTransactionReceipt {
  return {
    blockHash: tx.blockHash!,
    blockNumber: tx.blockNumber!,
    transactionHash: tx.hash!,
    transactionIndex: tx.transactionIndex!,
    from: tx.from!,
    to: tx.to ?? null,
    contractAddress: tx.contractAddress ?? null,
    logsBloom: tx.logsBloom ?? zeroLogsBloom,
    gasUsed: tx.gasUsed ?? "0x0",
    cumulativeGasUsed: tx.cumulativeGasUsed ?? "0x0",
    effectiveGasPrice: tx.effectiveGasPrice ?? "0x0",
    root: tx.root ?? zeroHash,
    status: tx.status === "success" ? "0x1" : "0x0",
    type: tx.type ?? "0x0",
    logs: [],
  } as SyncTransactionReceipt;
}

/**
 * Convert an entire QueryResponseData bundle into the Sync* arrays
 * that the sync store expects.
 *
 * Transactions are grouped by blockNumber and attached to their parent
 * blocks via `responseBlockToSyncBlock`. Receipts are extracted from
 * the transaction response (the query API embeds receipt fields on
 * the transaction object).
 */
export function mapQueryResponseData(data: QueryResponseData): {
  blocks: SyncBlock[];
  logs: SyncLog[];
  transactions: SyncTransaction[];
  transactionReceipts: SyncTransactionReceipt[];
  traces: SyncTrace[];
} {
  const rawTxs = data.transactions ?? [];

  // Map transactions and receipts from the same response data
  const txs = rawTxs.map(responseTransactionToSyncTransaction);
  const transactionReceipts = rawTxs
    .filter((tx) => tx.status !== undefined)
    .map(responseTransactionToSyncTransactionReceipt);

  // Group transactions by block number
  const txsByBlock = new Map<Hex, SyncTransaction[]>();
  for (const tx of txs) {
    const key = tx.blockNumber;
    let arr = txsByBlock.get(key);
    if (!arr) {
      arr = [];
      txsByBlock.set(key, arr);
    }
    arr.push(tx);
  }

  // Map blocks, attaching their transactions
  const blocks = (data.blocks ?? []).map((b) =>
    responseBlockToSyncBlock(b, txsByBlock.get(b.number!) ?? []),
  );

  const logs = (data.logs ?? []).map(responseLogToSyncLog);
  const traces = (data.traces ?? []).map(responseTraceToSyncTrace);

  return { blocks, logs, transactions: txs, transactionReceipts, traces };
}
