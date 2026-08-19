// HyperSync-backed fast path for the two hot historical-sync requests.
//
// Enabled with PONDER_HYPERSYNC=true and an API token in ENVIO_API_TOKEN or
// HYPERSYNC_API_TOKEN (https://envio.dev/app/api-tokens). When enabled,
// bounded-range eth_getLogs requests are served by a HyperSync query whose
// join also returns the blocks and transactions those logs touch; the blocks
// (with their matched transactions) are cached, and the per-eventful-block
// eth_getBlockByNumber requests that follow are served from that cache. Every
// other request — near-tip ranges, cache misses, realtime — falls through to
// the RPC unchanged.
import type {
  Block as HsBlock,
  Log as HsLog,
  Transaction as HsTransaction,
  HypersyncClient,
  Query,
} from "@envio-dev/hypersync-client";
import { type Hex, hexToNumber, isHex, numberToHex } from "viem";
import type { SyncBlock, SyncLog, SyncTransaction } from "@/internal/types.js";

const resolveToken = (): string | undefined => {
  const token = process.env.ENVIO_API_TOKEN ?? process.env.HYPERSYNC_API_TOKEN;
  return token === undefined || token.trim() === "" ? undefined : token;
};

export const hypersyncEnabled = (): boolean =>
  process.env.PONDER_HYPERSYNC === "true" && resolveToken() !== undefined;

// The client is an optional peer dependency, imported lazily so a Ponder
// install that never enables this path carries no native module. An absent or
// failing import permanently resolves to null and every request falls back to
// the RPC.
type HypersyncModule = typeof import("@envio-dev/hypersync-client");
let modulePromise: Promise<HypersyncModule | null> | undefined;
const getModule = (): Promise<HypersyncModule | null> => {
  modulePromise ??= import("@envio-dev/hypersync-client").then(
    (mod) => mod,
    () => null,
  );
  return modulePromise;
};

let client: HypersyncClient | undefined;
const getClient = async (): Promise<HypersyncClient | null> => {
  if (client === undefined) {
    const mod = await getModule();
    if (mod === null) return null;
    client = mod.HypersyncClient.new({
      url: process.env.PONDER_HYPERSYNC_URL ?? "https://1.hypersync.xyz",
      bearerToken: resolveToken(),
    });
  }
  return client;
};

// Archive height, cached like a monotonic clock: a height at or past the
// requested block is always trusted, otherwise it is refreshed at most every
// two seconds. Requests past the archive fall back to the RPC, which is
// authoritative for the head.
let heightCache: { fetchedAt: number; height: number } | undefined;
const coversBlock = async (toBlock: number): Promise<boolean> => {
  if (heightCache !== undefined) {
    if (heightCache.height >= toBlock) return true;
    if (Date.now() - heightCache.fetchedAt < 2_000) return false;
  }
  try {
    const hypersync = await getClient();
    if (hypersync === null) return false;
    const height = await hypersync.getHeight();
    heightCache = { fetchedAt: Date.now(), height };
    return height >= toBlock;
  } catch {
    return false;
  }
};

/**
 * Blocks touched by recent log queries, keyed by number and consumed
 * (deleted) on read. Transactions are kept as a map by index and merged
 * across queries: with several log filters over one range, each filter's
 * query joins only its own logs' transactions, and the block must end up
 * holding the union before its one reader validates every matched log
 * against it. The cap only guards against a consumer that never comes.
 */
type CacheEntry = {
  block: HsBlock;
  transactions: Map<number, SyncTransaction>;
};
const blockCache = new Map<number, CacheEntry>();
const BLOCK_CACHE_CAP = 50_000;

const hex = (value: string): Hex => value.toLowerCase() as Hex;
const quantity = (value: number | bigint): Hex => numberToHex(value);

const toSyncLog = (log: HsLog): SyncLog => ({
  address: hex(log.address!),
  blockHash: hex(log.blockHash!),
  blockNumber: quantity(log.blockNumber!),
  data: hex(log.data ?? "0x"),
  logIndex: quantity(log.logIndex!),
  removed: log.removed ?? false,
  topics: log.topics.filter(
    (topic): topic is string => topic !== undefined && topic !== null,
  ) as SyncLog["topics"],
  transactionHash: hex(log.transactionHash!),
  transactionIndex: quantity(log.transactionIndex!),
});

const toSyncTransaction = (tx: HsTransaction): SyncTransaction =>
  ({
    blockHash: hex(tx.blockHash!),
    blockNumber: quantity(tx.blockNumber!),
    from: hex(tx.from!),
    gas: quantity(tx.gas ?? 0n),
    gasPrice: tx.gasPrice !== undefined ? quantity(tx.gasPrice) : undefined,
    maxFeePerGas:
      tx.maxFeePerGas !== undefined ? quantity(tx.maxFeePerGas) : undefined,
    maxPriorityFeePerGas:
      tx.maxPriorityFeePerGas !== undefined
        ? quantity(tx.maxPriorityFeePerGas)
        : undefined,
    hash: hex(tx.hash!),
    input: hex(tx.input ?? "0x"),
    nonce: quantity(tx.nonce ?? 0n),
    to: tx.to === undefined || tx.to === null ? null : hex(tx.to),
    transactionIndex: quantity(tx.transactionIndex!),
    value: quantity(tx.value ?? 0n),
    type: tx.kind !== undefined ? numberToHex(tx.kind) : "0x0",
    v: tx.v !== undefined ? tx.v : (tx.yParity ?? "0x0"),
    r: tx.r ?? "0x0",
    s: tx.s ?? "0x0",
    accessList: tx.accessList as SyncTransaction["accessList"],
    chainId: tx.chainId !== undefined ? numberToHex(tx.chainId) : undefined,
  }) as unknown as SyncTransaction;

const toSyncBlock = (
  block: HsBlock,
  transactions: SyncTransaction[],
): SyncBlock =>
  ({
    baseFeePerGas:
      block.baseFeePerGas !== undefined ? quantity(block.baseFeePerGas) : null,
    difficulty: quantity(block.difficulty ?? 0n),
    extraData: hex(block.extraData ?? "0x"),
    gasLimit: quantity(block.gasLimit ?? 0n),
    gasUsed: quantity(block.gasUsed ?? 0n),
    hash: hex(block.hash!),
    logsBloom: hex(block.logsBloom!),
    miner: hex(block.miner!),
    mixHash: block.mixHash !== undefined ? hex(block.mixHash) : null,
    nonce:
      block.nonce !== undefined ? numberToHex(block.nonce, { size: 8 }) : null,
    number: quantity(block.number!),
    parentHash: hex(block.parentHash!),
    receiptsRoot: hex(block.receiptsRoot!),
    sha3Uncles: block.sha3Uncles !== undefined ? hex(block.sha3Uncles) : null,
    size: quantity(block.size ?? 0n),
    stateRoot: hex(block.stateRoot!),
    timestamp: quantity(block.timestamp!),
    totalDifficulty:
      block.totalDifficulty !== undefined
        ? quantity(block.totalDifficulty)
        : null,
    transactionsRoot: hex(block.transactionsRoot!),
    transactions,
    uncles: (block.uncles ?? []) as Hex[],
  }) as unknown as SyncBlock;

type GetLogsParams = [
  {
    address?: Hex | Hex[];
    topics?: (Hex | Hex[] | null)[];
    fromBlock?: Hex | string;
    toBlock?: Hex | string;
    blockHash?: Hex;
  },
];

/**
 * Serve a bounded-range eth_getLogs from HyperSync, filling the block cache
 * with the blocks (and their matched transactions) as a side effect. Returns
 * null when the request is not one this path serves — the caller then uses
 * the RPC exactly as before.
 */
export const hypersyncGetLogs = async (
  params: GetLogsParams,
): Promise<SyncLog[] | null> => {
  const filter = params[0];
  if (
    filter === undefined ||
    filter.blockHash !== undefined ||
    !isHex(filter.fromBlock) ||
    !isHex(filter.toBlock)
  ) {
    return null;
  }

  const fromBlock = hexToNumber(filter.fromBlock as Hex);
  const toBlock = hexToNumber(filter.toBlock as Hex);
  if (toBlock < fromBlock) return [];
  const mod = await getModule();
  const hypersync = await getClient();
  if (mod === null || hypersync === null) return null;
  if ((await coversBlock(toBlock)) === false) return null;
  const { BlockField, JoinMode, LogField, TransactionField } = mod;

  const address =
    filter.address === undefined
      ? undefined
      : (Array.isArray(filter.address) ? filter.address : [filter.address]).map(
          (a) => a.toLowerCase(),
        );
  const topics = (filter.topics ?? []).map((topic) =>
    topic === null || topic === undefined
      ? []
      : Array.isArray(topic)
        ? topic
        : [topic],
  );

  const query: Query = {
    fromBlock,
    toBlock: toBlock + 1, // hypersync's toBlock is exclusive
    logs: [{ address, topics }],
    fieldSelection: {
      log: [
        LogField.Removed,
        LogField.LogIndex,
        LogField.TransactionIndex,
        LogField.TransactionHash,
        LogField.BlockHash,
        LogField.BlockNumber,
        LogField.Address,
        LogField.Data,
        LogField.Topic0,
        LogField.Topic1,
        LogField.Topic2,
        LogField.Topic3,
      ],
      block: [
        BlockField.Number,
        BlockField.Hash,
        BlockField.ParentHash,
        BlockField.Nonce,
        BlockField.Sha3Uncles,
        BlockField.LogsBloom,
        BlockField.TransactionsRoot,
        BlockField.StateRoot,
        BlockField.ReceiptsRoot,
        BlockField.Miner,
        BlockField.Difficulty,
        BlockField.TotalDifficulty,
        BlockField.ExtraData,
        BlockField.Size,
        BlockField.GasLimit,
        BlockField.GasUsed,
        BlockField.Timestamp,
        BlockField.MixHash,
        BlockField.BaseFeePerGas,
      ],
      transaction: [
        TransactionField.BlockHash,
        TransactionField.BlockNumber,
        TransactionField.From,
        TransactionField.Gas,
        TransactionField.GasPrice,
        TransactionField.Hash,
        TransactionField.Input,
        TransactionField.Nonce,
        TransactionField.To,
        TransactionField.TransactionIndex,
        TransactionField.Value,
        TransactionField.V,
        TransactionField.R,
        TransactionField.S,
        TransactionField.YParity,
        TransactionField.MaxPriorityFeePerGas,
        TransactionField.MaxFeePerGas,
        TransactionField.ChainId,
        TransactionField.Kind,
      ],
    },
    joinMode: JoinMode.Default,
  };

  const logs: SyncLog[] = [];
  const blocks = new Map<number, HsBlock>();
  const transactionsByBlock = new Map<number, SyncTransaction[]>();

  let next = fromBlock;
  while (next <= toBlock) {
    const response = await hypersync.get({ ...query, fromBlock: next });
    for (const log of response.data.logs) logs.push(toSyncLog(log));
    for (const block of response.data.blocks) blocks.set(block.number!, block);
    for (const tx of response.data.transactions) {
      const list = transactionsByBlock.get(tx.blockNumber!) ?? [];
      list.push(toSyncTransaction(tx));
      transactionsByBlock.set(tx.blockNumber!, list);
    }
    if (response.nextBlock <= next) {
      // No forward progress would loop forever; let the RPC handle it.
      return null;
    }
    next = response.nextBlock;
  }

  for (const [number, block] of blocks) {
    const entry = blockCache.get(number) ?? {
      block,
      transactions: new Map<number, SyncTransaction>(),
    };
    for (const transaction of transactionsByBlock.get(number) ?? []) {
      entry.transactions.set(
        hexToNumber(transaction.transactionIndex),
        transaction,
      );
    }
    if (blockCache.has(number) || blockCache.size < BLOCK_CACHE_CAP) {
      blockCache.set(number, entry);
    }
  }

  logs.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? hexToNumber(a.logIndex) - hexToNumber(b.logIndex)
      : hexToNumber(a.blockNumber) - hexToNumber(b.blockNumber),
  );

  return logs;
};

/** A cached block is consumed by its one expected reader. */
export const takeHypersyncBlock = (
  blockNumber: number,
): SyncBlock | undefined => {
  const entry = blockCache.get(blockNumber);
  if (entry === undefined) return undefined;
  blockCache.delete(blockNumber);
  const transactions = [...entry.transactions.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, transaction]) => transaction);
  return toSyncBlock(entry.block, transactions);
};
