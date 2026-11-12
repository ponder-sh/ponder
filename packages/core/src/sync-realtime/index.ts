import {
  type GetLogsRetryHelperParameters,
  getLogsRetryHelper,
} from "@ponder/utils";
import {
  type Address,
  type Hash,
  type Hex,
  hexToBytes,
  hexToNumber,
  numberToHex,
  type RpcError,
  zeroHash,
} from "viem";
import type { Common } from "@/internal/common.js";
import { ShutdownError } from "@/internal/errors.js";
import type {
  BlockFilter,
  Chain,
  EventCallback,
  Factory,
  FactoryFragmentId,
  FactoryId,
  Filter,
  LightBlock,
  LogFilter,
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import {
  ADDRESS_CHUNK_SIZE,
  debug_traceBlockByHash,
  eth_getBlockByHash,
  eth_getBlockByNumber,
  eth_getLogs,
  eth_getTransactionReceipts,
  validateLogsAndBlock,
  validateReceiptsAndBlock,
  validateTracesAndBlock,
  validateTransactionsAndBlock,
} from "@/rpc/actions.js";
import type { Rpc, RpcLogTrigger } from "@/rpc/index.js";
import {
  getChildAddress,
  getFilterFactories,
  isAddressFactory,
  isAddressMatched,
  isBlockFilterMatched,
  isBlockInFilter,
  isLogFactoryMatched,
  isLogFilterMatched,
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
  mergeLogFiltersToBlockRequest,
} from "@/runtime/filter.js";
import {
  getFactoryFragmentId,
  getFactoryFragmentIds,
} from "@/runtime/fragments.js";
import type { SyncProgress } from "@/runtime/index.js";
import { isAsyncExecutionChain } from "@/utils/finality.js";
import { getChunks } from "@/utils/interval.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { createLock } from "@/utils/mutex.js";
import { range } from "@/utils/range.js";
import { startClock } from "@/utils/timer.js";
import {
  getFactoryBloom,
  getLogFilterBloom,
  isFactoryInBloom,
  isFilterInBloom,
  isInBloom,
  zeroLogsBloom,
} from "./bloom.js";

export type RealtimeSync = {
  /**
   * Fetch block event data and reconcile it into the local chain.
   *
   * @param block - The block to reconcile.
   */
  sync(
    block: SyncBlock | SyncBlockHeader,
    blockCallback?: (isAccepted: boolean) => void,
  ): AsyncGenerator<RealtimeSyncEvent>;
  onError(error: Error): void;
  /** Local chain of blocks that have not been finalized. */
  unfinalizedBlocks: LightBlock[];
  /** `true` if the chain is synced with `experimentalRangeScan`. */
  isRangeScan: boolean;
  /**
   * Log notifications that trigger a scan, used when the chain has `ws`.
   * `undefined` unless the chain is range scanned.
   */
  logTrigger: RpcLogTrigger | undefined;
};

export type BlockWithEventData = {
  block: SyncBlock | SyncBlockHeader;
  transactions: SyncTransaction[];
  transactionReceipts: SyncTransactionReceipt[];
  logs: SyncLog[];
  traces: SyncTrace[];
  /** Child addresses found in the block per `factory_log` fragment ID. */
  childAddresses: Map<FactoryFragmentId, Set<Address>>;
};

export type RealtimeSyncEvent =
  | ({
      type: "block";
      hasMatchedFilter: boolean;
      blockCallback?: (isAccepted: boolean) => void;
    } & BlockWithEventData)
  | { type: "finalize"; block: LightBlock }
  | { type: "reorg"; block: LightBlock; reorgedBlocks: LightBlock[] };

type CreateRealtimeSyncParameters = {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  eventCallbacks: EventCallback[];
  syncProgress: Pick<SyncProgress, "finalized">;
  childAddresses: Map<FactoryId, Map<Address, number>>;
};

const MAX_LATEST_BLOCK_ATTEMPT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_QUEUED_BLOCKS = 50;

export const createRealtimeSync = (
  args: CreateRealtimeSyncParameters,
): RealtimeSync => {
  let finalizedBlock: LightBlock = args.syncProgress.finalized;
  const childAddresses = args.childAddresses;
  /** Annotates `childAddresses` for efficient lookup by block number */
  const childAddressesPerBlock = new Map<
    number,
    BlockWithEventData["childAddresses"]
  >();
  /**
   * Blocks that have been ingested and are
   * waiting to be finalized. It is an invariant that
   * all blocks are linked to each other,
   * `parentHash` => `hash`.
   *
   * @dev The range-scan path is the exception: it only ingests blocks that
   * contain matching logs, plus one head block per poll, so the list is sparse
   * and not parent-linked. Consumers key on block number
   * (`runtime/realtime.ts`), so this only matters for code that walks the list
   * by hash.
   */
  let unfinalizedBlocks: LightBlock[] = [];
  /** Closest-to-tip block that has been fetched but not yet reconciled. */
  let latestFetchedBlock: LightBlock | undefined;
  let fetchAndReconcileLatestBlockErrorCount = 0;
  /** When the current run of failed latest-block attempts began. */
  let firstLatestBlockErrorAt: number | undefined;

  const realtimeSyncLock = createLock();

  const factories: Factory[] = [];
  const factoryIds = new Set<FactoryId>();
  const factoryFragmentIds = new Map<Factory, FactoryFragmentId[]>();
  const logFilters: LogFilter[] = [];
  const traceFilters: TraceFilter[] = [];
  const transactionFilters: TransactionFilter[] = [];
  const transferFilters: TransferFilter[] = [];
  const blockFilters: BlockFilter[] = [];

  for (const eventCallback of args.eventCallbacks) {
    if (
      eventCallback.filter.toBlock &&
      eventCallback.filter.toBlock <= hexToNumber(finalizedBlock.number)
    ) {
      continue;
    }

    // Collect filters from event callbacks
    if (eventCallback.filter.type === "log") {
      logFilters.push(eventCallback.filter);
    } else if (eventCallback.filter.type === "trace") {
      traceFilters.push(eventCallback.filter);
    } else if (eventCallback.filter.type === "transaction") {
      transactionFilters.push(eventCallback.filter);
    } else if (eventCallback.filter.type === "transfer") {
      transferFilters.push(eventCallback.filter);
    } else if (eventCallback.filter.type === "block") {
      blockFilters.push(eventCallback.filter);
    }

    for (const factory of getFilterFactories(eventCallback.filter)) {
      if (
        factory.toBlock &&
        factory.toBlock <= hexToNumber(finalizedBlock.number)
      ) {
        continue;
      }

      if (factoryIds.has(factory.id)) continue;
      factoryIds.add(factory.id);
      factories.push(factory);
      factoryFragmentIds.set(factory, getFactoryFragmentIds(factory));
    }
  }

  const logFilterBlooms = logFilters.map(getLogFilterBloom);
  const factoryBlooms = factories.map(getFactoryBloom);

  /**
   * Experimental range-scan fast path. When enabled, each poll scans the
   * unfinalized window with ranged `eth_getLogs` requests rather than fetching
   * every block, so a `pollingInterval` larger than the chain's block time
   * reduces RPC usage. Supported when every indexed source is a `log` source,
   * factory sources included; otherwise the default per-block sync is used.
   *
   * @dev The comparison against the default path assumes its `logsBloom` check
   * (see `fetchBlockEventData`), which skips `eth_getLogs` for blocks whose
   * bloom doesn't match any filter. Without it the default path would cost two
   * requests per block rather than one, and the range scan would win by a much
   * wider margin than it actually does.
   */
  const canRangeScan =
    args.chain.experimentalRangeScan &&
    logFilters.length > 0 &&
    traceFilters.length === 0 &&
    transactionFilters.length === 0 &&
    transferFilters.length === 0 &&
    blockFilters.length === 0;

  if (args.chain.experimentalRangeScan && canRangeScan === false) {
    args.common.logger.warn({
      msg: "Ignoring 'experimentalRangeScan' because the chain has block, transaction, trace, or transfer sources. Using the default per-block realtime sync, polled every 'pollingInterval': with 'experimentalRangeScan', 'ws' only carries log notifications.",
      chain: args.chain.name,
      chain_id: args.chain.id,
    });
  }

  /**
   * Unfinalized blocks that the range scan has already processed, keyed by
   * block number (range-scan path): the block hash and the indexes of the logs
   * the scan returned for it.
   *
   * @dev Includes every block a scan returned a log for, also blocks whose logs
   * all failed client-side matching. A block that was scanned but not emitted
   * must still be recorded, otherwise it would be re-detected as a reorg on
   * every subsequent poll.
   *
   * @dev The log indexes catch a block whose logs were split across requests
   * and one request missed them, for example because its node was behind the
   * others. A later scan that returns a log not recorded here re-ingests the
   * block.
   */
  const scannedBlocks = new Map<
    number,
    { hash: Hash; logIndexes: Set<number> }
  >();

  /**
   * Addresses and `topic0`s that the range scan requests, split by whether the
   * source has a static address.
   *
   * @dev Only `topic0` is requested: the union of every source's `topic0`
   * matches a superset of each source, and the `topics` field is fragile for
   * many rpc providers. Logs are matched precisely client-side afterwards.
   */
  const rangeScanSources = (() => {
    /** Addresses of log filters and factories with a static address. */
    const staticAddresses = new Set<Address>();
    /** `topic0`s of log filters and factories with a static address. */
    const staticTopic0s = new Set<Hex>();
    /**
     * `topic0`s of log filters whose address is a factory or `undefined`, and
     * of factories without an address. These are requested without an address.
     */
    const openTopic0s = new Set<Hex>();

    const toAddresses = (address: Address | Address[]) =>
      Array.isArray(address) ? address : [address];

    for (const filter of logFilters) {
      // Note: an empty address list matches no logs.
      if (Array.isArray(filter.address) && filter.address.length === 0)
        continue;

      if (filter.address === undefined || isAddressFactory(filter.address)) {
        openTopic0s.add(toLowerCase(filter.topic0));
      } else {
        for (const address of toAddresses(filter.address)) {
          staticAddresses.add(toLowerCase(address));
        }
        staticTopic0s.add(toLowerCase(filter.topic0));
      }
    }

    for (const factory of factories) {
      if (Array.isArray(factory.address) && factory.address.length === 0) {
        continue;
      }

      if (factory.address === undefined) {
        openTopic0s.add(toLowerCase(factory.eventSelector));
      } else {
        for (const address of toAddresses(factory.address)) {
          staticAddresses.add(toLowerCase(address));
        }
        staticTopic0s.add(toLowerCase(factory.eventSelector));
      }
    }

    return { staticAddresses, staticTopic0s, openTopic0s };
  })();

  /**
   * Blocks of notified logs, by hash, that a scan reaching them must return
   * (range-scan path with `ws`), and how many scans were rejected for missing
   * them.
   */
  const expectedLogBlocks = new Map<
    Hash,
    { number: number; rejections: number }
  >();
  const LOG_TRIGGER_MAX_REJECTIONS = 3;
  /**
   * Whether scans run every `pollingInterval` rather than on log notifications
   * and the heartbeat (range-scan path, see `RpcLogTrigger.setPolling`).
   */
  let isLogTriggerPolling = true;

  /**
   * Log notifications that trigger a scan (range-scan path with `ws`).
   *
   * @dev A notification is only a trigger: the scan reads the logs, so a
   * dropped notification delays its event to the next heartbeat scan and never
   * loses it. Static sources are subscribed by address, the others by `topic0`
   * alone, which keeps notifications for other contracts' logs to the
   * signatures of the sources without a static address. Those are matched
   * here against the known child addresses and trigger nothing. A factory's
   * own log triggers the scan that finds its children.
   */
  const logTrigger: RpcLogTrigger | undefined = canRangeScan
    ? {
        filters: [
          ...range(
            0,
            Math.ceil(
              rangeScanSources.staticAddresses.size / ADDRESS_CHUNK_SIZE,
            ),
          ).map((i) => ({
            address: Array.from(rangeScanSources.staticAddresses).slice(
              i * ADDRESS_CHUNK_SIZE,
              (i + 1) * ADDRESS_CHUNK_SIZE,
            ),
            topics: [Array.from(rangeScanSources.staticTopic0s)] as [Hex[]],
          })),
          ...(rangeScanSources.openTopic0s.size > 0
            ? [
                {
                  topics: [Array.from(rangeScanSources.openTopic0s)] as [Hex[]],
                },
              ]
            : []),
        ],
        isTrigger: (log) => {
          if (
            factories.some((factory) => isLogFactoryMatched({ factory, log }))
          )
            return true;

          return logFilters.some(
            (filter) =>
              isLogFilterMatched({ filter, log }) &&
              (isAddressFactory(filter.address)
                ? isAddressMatched({
                    address: log.address,
                    blockNumber: hexToNumber(log.blockNumber),
                    childAddresses: childAddresses.get(filter.address.id)!,
                  })
                : true),
          );
        },
        expect: (log) => {
          // Note: a reorg removed the log, so its block can't be returned.
          if (log.removed === true) {
            expectedLogBlocks.delete(log.blockHash);
          } else if (expectedLogBlocks.has(log.blockHash) === false) {
            expectedLogBlocks.set(log.blockHash, {
              number: hexToNumber(log.blockNumber),
              rejections: 0,
            });
          }
        },
        isScanned: ({ blockNumber, blockHash, logIndex }) => {
          const number = hexToNumber(blockNumber);
          if (number <= hexToNumber(finalizedBlock.number)) return true;
          const scanned = scannedBlocks.get(number);
          return (
            scanned?.hash === blockHash &&
            scanned.logIndexes.has(hexToNumber(logIndex))
          );
        },
        // Note: by default a third of the reorg window, so finality keeps
        // advancing and a missed notification is swept up well within it, but
        // never more often than `pollingInterval`.
        heartbeatInterval:
          args.chain.heartbeatInterval ??
          (args.chain.reorgWindow > 0
            ? Math.max(
                args.chain.pollingInterval,
                Math.floor((args.chain.reorgWindow * 1_000) / 3),
              )
            : args.chain.pollingInterval),
        setPolling: (isPolling) => {
          isLogTriggerPolling = isPolling;
        },
        hasFailed: () => fetchAndReconcileLatestBlockErrorCount > 0,
      }
    : undefined;

  /**
   * How each scan requests logs.
   *
   * - `static`: every source has a static address. One request per batch of
   *   `ADDRESS_CHUNK_SIZE` addresses.
   * - `merged`: one request without an address for every source's `topic0`,
   *   the request the per-block path builds for one block
   *   (`mergeLogFiltersToBlockRequest`) applied to a range.
   * - `split`: the `static` requests, plus one request without an address for
   *   the `topic0`s of the sources without a static address.
   *
   * A chain with a source without a static address starts `merged`, one
   * request per scan. It switches to `split` for the rest of the run once a
   * merged scan returns more than `RANGE_SCAN_MAX_MERGE_NOISE` logs that only
   * the merge requested: a static source's signature emitted by other
   * contracts, which is common for signatures such as ERC-20 `Transfer`.
   *
   * @dev A single request also gives one consistent view of the chain.
   * Several requests (`split`, or more than `ADDRESS_CHUNK_SIZE` addresses) can
   * observe different chains if a reorg happens between them, or if one is
   * answered by a node that is behind. `reconcileRange` retries a poll that
   * reports a block at two hashes, and re-ingests a block once a later scan
   * returns logs that an earlier one missed.
   */
  let rangeScanMode: "static" | "merged" | "split" =
    rangeScanSources.openTopic0s.size === 0 ? "static" : "merged";
  const RANGE_SCAN_MAX_MERGE_NOISE = 1_000;

  /**
   * Maximum block range for a range-scan `eth_getLogs` request. Starts at the
   * user-provided value (if any) and is narrowed when a provider rejects a
   * request for being too wide, so the same error isn't repeated every poll.
   */
  let rangeScanBlockRange: number | undefined = args.chain.ethGetLogsBlockRange;
  /** `true` if `rangeScanBlockRange` came from a limit stated by the provider. */
  let isRangeScanBlockRangeConfirmed =
    args.chain.ethGetLogsBlockRange !== undefined;

  /**
   * Approximate compute unit costs, used only to decide whether to warn that
   * the range scan isn't paying off. Taken from Alchemy's published table.
   *
   * @dev Providers price differently, so these are indicative. What matters is
   * the ratio: an `eth_getLogs` costs about three block requests.
   */
  const CU_BLOCK_REQUEST = 20;
  const CU_GET_LOGS_REQUEST = 60;
  /** Number of polls to sample before comparing the two strategies. */
  const RANGE_SCAN_SAMPLE_POLLS = 10;

  let rangeScanSampledPolls = 0;
  let rangeScanSampledBlocks = 0;
  let rangeScanSampledRequests = 0;
  let rangeScanSampledMatchedBlocks = 0;
  let rangeScanSampledHeads = 0;
  let rangeScanSampledBloomHeads = 0;
  let hasSkippedFirstRangeScanPoll = false;
  let hasCheckedRangeScanCost = false;

  /**
   * Whether the default per-block sync would request logs for `block`: the
   * check `fetchBlockEventData` makes against its `logsBloom`.
   */
  const isBlockInBloom = (block: SyncBlock | SyncBlockHeader) => {
    const isAsyncExecution = isAsyncExecutionChain(args.chain.id);
    const bloom = hexToBytes(block.logsBloom);
    const blockNumber = hexToNumber(block.number);
    return (
      logFilters.some(
        (logFilter, i) =>
          isBlockInFilter(logFilter, blockNumber) &&
          (isAsyncExecution ||
            block.logsBloom === zeroLogsBloom ||
            isFilterInBloom({ bloom, filter: logFilterBlooms[i]! })),
      ) ||
      factories.some(
        (factory, i) =>
          isBlockInFilter(factory, blockNumber) &&
          (isAsyncExecution ||
            block.logsBloom === zeroLogsBloom ||
            isFactoryInBloom({ bloom, factory: factoryBlooms[i]! })),
      )
    );
  };

  /**
   * Warn once if the range scan is using more RPC credits than the default
   * per-block sync would have.
   *
   * @dev Break-even is not a fixed number of blocks per poll: it depends on how
   * many `eth_getLogs` requests each scan takes (the unfinalized window spans `reorgWindow` and may be
   * split by block range or address batch) and on how many blocks contain a matching event. Both are measured
   * here rather than assumed.
   *
   * The per-block path fetches every block and, thanks to the `logsBloom` check
   * in `fetchBlockEventData`, only issues `eth_getLogs` for blocks whose bloom
   * matches a filter. Blooms of busy chains are mostly full, so that includes
   * many blocks without a matching log. This path sees only the head of each
   * scan, so the share of blocks the per-block path would request logs for is
   * estimated from the heads' blooms, and never below the blocks that had a
   * matching log.
   *
   * @dev With log notifications, scans follow notifications and the heartbeat
   * rather than `pollingInterval`, so only polls made while the subscription
   * is down or paused are sampled.
   */
  const recordRangeScanPoll = ({
    blocks,
    requests,
    matchedBlocks,
    head,
  }: {
    blocks: number;
    requests: number;
    matchedBlocks: number;
    /** The scanned head, if this poll scanned a new one. */
    head?: SyncBlock | SyncBlockHeader;
  }) => {
    if (hasCheckedRangeScanCost) return;
    if (isLogTriggerPolling === false) return;

    // Skip the first poll, which covers the gap left by the historical sync
    // rather than one polling interval.
    if (hasSkippedFirstRangeScanPoll === false) {
      hasSkippedFirstRangeScanPoll = true;
      return;
    }

    rangeScanSampledPolls += 1;
    rangeScanSampledBlocks += blocks;
    rangeScanSampledRequests += requests;
    rangeScanSampledMatchedBlocks += matchedBlocks;
    if (head !== undefined) {
      rangeScanSampledHeads += 1;
      if (isBlockInBloom(head)) rangeScanSampledBloomHeads += 1;
    }

    if (rangeScanSampledPolls < RANGE_SCAN_SAMPLE_POLLS) return;

    hasCheckedRangeScanCost = true;

    // Note: a poll where no block elapsed still costs one block request on
    // either path, hence the `max`.
    const rangeScanCost =
      rangeScanSampledPolls * CU_BLOCK_REQUEST +
      rangeScanSampledRequests * CU_GET_LOGS_REQUEST +
      rangeScanSampledMatchedBlocks * CU_BLOCK_REQUEST;
    const bloomMatchedBlocks =
      rangeScanSampledHeads === 0
        ? 0
        : (rangeScanSampledBlocks * rangeScanSampledBloomHeads) /
          rangeScanSampledHeads;
    const perBlockCost = Math.round(
      Math.max(rangeScanSampledBlocks, rangeScanSampledPolls) *
        CU_BLOCK_REQUEST +
        Math.max(rangeScanSampledMatchedBlocks, bloomMatchedBlocks) *
          CU_GET_LOGS_REQUEST,
    );

    if (rangeScanCost >= perBlockCost) {
      const blocksPerPoll = rangeScanSampledBlocks / rangeScanSampledPolls;
      const requestsPerPoll = rangeScanSampledRequests / rangeScanSampledPolls;

      args.common.logger.warn({
        msg: `The 'experimentalRangeScan' option is not reducing RPC usage on this chain. Over ${rangeScanSampledPolls} polls it used about ${rangeScanCost} credits versus ${perBlockCost} for the default per-block sync, with ${blocksPerPoll.toFixed(1)} blocks and ${requestsPerPoll.toFixed(1)} 'eth_getLogs' requests per poll. Increase 'pollingInterval', or disable 'experimentalRangeScan'.`,
        chain: args.chain.name,
        chain_id: args.chain.id,
        polling_interval: args.chain.pollingInterval,
        blocks_per_poll: blocksPerPoll,
        requests_per_poll: requestsPerPoll,
      });
    }
  };

  const getLatestUnfinalizedBlock = () => {
    if (unfinalizedBlocks.length === 0) {
      return finalizedBlock;
    } else return unfinalizedBlocks[unfinalizedBlocks.length - 1]!;
  };

  /**
   * Child addresses created by `logs` per `factory_log` fragment ID, and the
   * logs that created them.
   */
  const getBlockChildAddresses = (
    logs: SyncLog[],
  ): {
    childAddresses: BlockWithEventData["childAddresses"];
    factoryLogs: Set<SyncLog>;
  } => {
    const blockChildAddresses: BlockWithEventData["childAddresses"] = new Map();
    const factoryLogs = new Set<SyncLog>();

    const childAddressDecodeFailureIds = new Set<string>();
    let childAddressDecodeFailureCount = 0;
    let childAddressDecodeSuccessCount = 0;

    for (const factory of factories) {
      for (const log of logs) {
        if (isLogFactoryMatched({ factory, log })) {
          factoryLogs.add(log);
          let address: Address;
          try {
            address = getChildAddress({ log, factory });
            childAddressDecodeSuccessCount++;
          } catch (error) {
            if (factory.address === undefined) {
              childAddressDecodeFailureCount++;
              if (childAddressDecodeFailureIds.has(factory.id) === false) {
                childAddressDecodeFailureIds.add(factory.id);
                args.common.logger.debug({
                  msg: "Failed to extract child address from log matched by factory using the provided ABI item",
                  chain: args.chain.name,
                  chain_id: args.chain.id,
                  factory: factory.sourceId,
                  block_number: hexToNumber(log.blockNumber),
                  log_index: hexToNumber(log.logIndex),
                  data: log.data,
                  topics: JSON.stringify(log.topics),
                });
              }
              continue;
            } else {
              throw error;
            }
          }
          const fragmentId = getFactoryFragmentId(factory, log.address);
          if (blockChildAddresses.has(fragmentId) === false) {
            blockChildAddresses.set(fragmentId, new Set());
          }
          blockChildAddresses.get(fragmentId)!.add(address);
        }
      }
    }

    if (childAddressDecodeFailureCount > 0) {
      args.common.logger.debug({
        msg: "Logs matched by factory contained child addresses that could not be extracted",
        failure_count: childAddressDecodeFailureCount,
        success_count: childAddressDecodeSuccessCount,
      });
    }

    return { childAddresses: blockChildAddresses, factoryLogs };
  };

  /**
   * Remove the child addresses that `reorgedBlocks` created from
   * `childAddresses`.
   */
  const removeReorgedChildAddresses = (reorgedBlocks: LightBlock[]) => {
    for (const block of reorgedBlocks) {
      const blockNumber = hexToNumber(block.number);
      const blockChildAddresses = childAddressesPerBlock.get(blockNumber)!;
      for (const factory of factories) {
        const knownAddresses = childAddresses.get(factory.id)!;
        for (const fragmentId of factoryFragmentIds.get(factory)!) {
          const blockAddresses = blockChildAddresses.get(fragmentId);
          if (blockAddresses === undefined) continue;
          for (const address of blockAddresses) {
            if (knownAddresses.get(address) === blockNumber) {
              knownAddresses.delete(address);
            }
          }
        }
      }
      childAddressesPerBlock.delete(blockNumber);
    }
  };

  /**
   * Fetch all data (logs, traces, receipts) for the specified block required by `args.sources`
   *
   * @dev The data returned by this function may include false positives. This
   * is due to the fact that factory addresses are unknown and are always
   * treated as "matched".
   */
  const fetchBlockEventData = async (
    maybeBlockHeader: SyncBlock | SyncBlockHeader,
  ): Promise<BlockWithEventData> => {
    const context = {
      logger: args.common.logger.child({ action: "fetch_block_data" }),
    };
    const endClock = startClock();

    let block: SyncBlock | undefined;
    let ethGetBlockMethod: "eth_getBlockByHash" | "eth_getBlockByNumber";

    if (maybeBlockHeader.transactions !== undefined) {
      block = maybeBlockHeader;
      ethGetBlockMethod = "eth_getBlockByNumber";
    } else {
      ethGetBlockMethod = "eth_getBlockByHash";
    }

    ////////
    // Logs
    ////////

    // Async-execution chains cannot reliably use blooms to filter or validate logs.
    // A zero `logsBloom` is treated as missing.
    const isAsyncExecution = isAsyncExecutionChain(args.chain.id);
    const blockNumber = hexToNumber(maybeBlockHeader.number);
    const bloom = hexToBytes(maybeBlockHeader.logsBloom);

    const logsRequestFilter = mergeLogFiltersToBlockRequest({
      logFilters: logFilters.filter(
        (logFilter, i) =>
          isBlockInFilter(logFilter, blockNumber) &&
          (isAsyncExecution ||
            maybeBlockHeader.logsBloom === zeroLogsBloom ||
            isFilterInBloom({ bloom, filter: logFilterBlooms[i]! })),
      ),
      factories: factories.filter(
        (factory, i) =>
          isBlockInFilter(factory, blockNumber) &&
          (isAsyncExecution ||
            maybeBlockHeader.logsBloom === zeroLogsBloom ||
            isFactoryInBloom({ bloom, factory: factoryBlooms[i]! })),
      ),
    });
    const shouldRequestLogs = logsRequestFilter !== undefined;

    let logs: SyncLog[] = [];
    if (shouldRequestLogs) {
      const logsRequestParams = {
        blockHash: maybeBlockHeader.hash,
        address: logsRequestFilter.address,
        topics: logsRequestFilter.topics,
      };

      if (block === undefined) {
        [block, logs] = await Promise.all([
          eth_getBlockByHash(args.rpc, [maybeBlockHeader.hash, true], context),
          eth_getLogs(args.rpc, [logsRequestParams], context),
        ]);
      } else {
        logs = await eth_getLogs(args.rpc, [logsRequestParams], context);
      }

      validateLogsAndBlock(
        logs,
        block,
        {
          method: "eth_getLogs",
          params: [logsRequestParams],
        },
        ethGetBlockMethod === "eth_getBlockByNumber"
          ? {
              method: "eth_getBlockByNumber",
              params: [block.number, true],
            }
          : {
              method: "eth_getBlockByHash",
              params: [block.hash, true],
            },
      );

      for (const log of logs) {
        if (log.transactionHash === zeroHash) {
          args.common.logger.warn({
            msg: "Detected log with empty transaction hash. This is expected for some chains like ZKsync.",
            action: "fetch_block_data",
            chain: args.chain.name,
            chain_id: args.chain.id,
            number: hexToNumber(block.number),
            hash: block.hash,
            logIndex: hexToNumber(log.logIndex),
          });
        }
      }
    }

    if (
      shouldRequestLogs === false &&
      (logFilters.length > 0 || factories.length > 0)
    ) {
      args.common.logger.trace({
        msg: "Skipped eth_getLogs request due to bloom filter result",
        action: "fetch_block_data",
        chain: args.chain.name,
        chain_id: args.chain.id,
        number: hexToNumber(maybeBlockHeader.number),
        hash: maybeBlockHeader.hash,
      });
    }

    ////////
    // Traces
    ////////

    const shouldRequestTraces =
      traceFilters.length > 0 || transferFilters.length > 0;

    let traces: SyncTrace[] = [];
    if (shouldRequestTraces) {
      if (block === undefined) {
        [block, traces] = await Promise.all([
          eth_getBlockByHash(args.rpc, [maybeBlockHeader.hash, true], context),
          debug_traceBlockByHash(
            args.rpc,
            [maybeBlockHeader.hash, { tracer: "callTracer" }],
            context,
          ),
        ]);
      } else {
        traces = await debug_traceBlockByHash(
          args.rpc,
          [block.hash, { tracer: "callTracer" }],
          context,
        );
      }

      validateTracesAndBlock(
        traces,
        block,
        {
          method: "debug_traceBlockByNumber",
          params: [block.number, { tracer: "callTracer" }],
        },
        ethGetBlockMethod === "eth_getBlockByNumber"
          ? {
              method: "eth_getBlockByNumber",
              params: [block.number, true],
            }
          : {
              method: "eth_getBlockByHash",
              params: [block.hash, true],
            },
      );
    }

    ////////
    // Get Matched
    ////////

    // Record `blockChildAddresses` that contain factory child addresses
    const { childAddresses: blockChildAddresses, factoryLogs } =
      getBlockChildAddresses(logs);

    const requiredTransactions = new Set<Hash>();
    const requiredTransactionReceipts = new Set<Hash>();

    // Remove logs that don't match a filter, recording required transactions
    logs = logs.filter((log) => {
      let isMatched = false;

      for (const filter of logFilters) {
        if (isLogFilterMatched({ filter, log })) {
          isMatched = true;
          if (log.transactionHash !== zeroHash) {
            requiredTransactions.add(log.transactionHash);
            if (filter.hasTransactionReceipt) {
              requiredTransactionReceipts.add(log.transactionHash);

              // skip to next log
              break;
            }
          }
        }
      }

      return isMatched;
    });

    if (isAsyncExecution === false && block !== undefined) {
      // Note: Exact `logsBloom` validations were considered too strict to add to `validateLogsAndBlock`.
      const logsBloom = hexToBytes(block.logsBloom);
      const checkedInputs = new Set<Hex>();
      let isInvalidLogsBloom = false;
      for (const log of [...factoryLogs, ...logs]) {
        if (
          checkedInputs.has(log.address) === false &&
          isInBloom(logsBloom, log.address) === false
        ) {
          isInvalidLogsBloom = true;
        }

        if (
          log.topics[0] &&
          checkedInputs.has(log.topics[0]) === false &&
          isInBloom(logsBloom, log.topics[0]) === false
        ) {
          isInvalidLogsBloom = true;
        }

        if (
          log.topics[1] &&
          checkedInputs.has(log.topics[1]) === false &&
          isInBloom(logsBloom, log.topics[1]) === false
        ) {
          isInvalidLogsBloom = true;
        }

        if (
          log.topics[2] &&
          checkedInputs.has(log.topics[2]) === false &&
          isInBloom(logsBloom, log.topics[2]) === false
        ) {
          isInvalidLogsBloom = true;
        }

        if (
          log.topics[3] &&
          checkedInputs.has(log.topics[3]) === false &&
          isInBloom(logsBloom, log.topics[3]) === false
        ) {
          isInvalidLogsBloom = true;
        }

        if (isInvalidLogsBloom) {
          args.common.logger.warn({
            msg: "Detected inconsistent RPC responses. Log not found in block.logsBloom.",
            action: "fetch_block_data",
            chain: args.chain.name,
            chain_id: args.chain.id,
            number: hexToNumber(block.number),
            hash: block.hash,
            logIndex: hexToNumber(log.logIndex),
          });
          break;
        }

        checkedInputs.add(log.address);
        for (const topic of log.topics) checkedInputs.add(topic);
      }
    }

    // Initial weak trace filtering before full filtering with factory addresses in handleBlock
    traces = traces.filter((trace) => {
      let isMatched = false;
      for (const filter of transferFilters) {
        if (
          isTransferFilterMatched({
            filter,
            trace: trace.trace,
            block: maybeBlockHeader,
          })
        ) {
          requiredTransactions.add(trace.transactionHash);
          isMatched = true;
          if (filter.hasTransactionReceipt) {
            requiredTransactionReceipts.add(trace.transactionHash);
            // skip to next trace
            break;
          }
        }
      }

      for (const filter of traceFilters) {
        if (
          isTraceFilterMatched({
            filter,
            trace: trace.trace,
            block: maybeBlockHeader,
          })
        ) {
          requiredTransactions.add(trace.transactionHash);
          isMatched = true;
          if (filter.hasTransactionReceipt) {
            requiredTransactionReceipts.add(trace.transactionHash);
            // skip to next trace
            break;
          }
        }
      }

      return isMatched;
    });

    ////////
    // Transactions
    ////////

    // exit early if no logs or traces were requested and no transactions are required
    if (block === undefined && transactionFilters.length === 0) {
      args.common.logger.debug(
        {
          msg: "Fetched block data",
          chain: args.chain.name,
          chain_id: args.chain.id,
          number: hexToNumber(maybeBlockHeader.number),
          hash: maybeBlockHeader.hash,
          transaction_count: 0,
          receipt_count: 0,
          trace_count: 0,
          log_count: 0,
          child_address_count: 0,
          duration: endClock(),
        },
        ["chain", "number", "hash"],
      );

      return {
        block: maybeBlockHeader,
        transactions: [],
        transactionReceipts: [],
        logs: [],
        traces: [],
        childAddresses: blockChildAddresses,
      };
    }

    if (block === undefined) {
      block = await eth_getBlockByHash(
        args.rpc,
        [maybeBlockHeader.hash, true],
        context,
      );
    }
    validateTransactionsAndBlock(
      block,
      ethGetBlockMethod === "eth_getBlockByNumber"
        ? {
            method: "eth_getBlockByNumber",
            params: [block.number, true],
          }
        : {
            method: "eth_getBlockByHash",
            params: [block.hash, true],
          },
    );

    const transactions = block.transactions.filter((transaction) => {
      let isMatched = requiredTransactions.has(transaction.hash);
      for (const filter of transactionFilters) {
        if (isTransactionFilterMatched({ filter, transaction })) {
          requiredTransactions.add(transaction.hash);
          requiredTransactionReceipts.add(transaction.hash);
          isMatched = true;
        }
      }
      return isMatched;
    });

    ////////
    // Transaction Receipts
    ////////

    const receiptResponses = await eth_getTransactionReceipts(
      args.rpc,
      { blockHash: block.hash, transactionHashes: requiredTransactionReceipts },
      context,
    );
    const transactionReceipts = receiptResponses.flatMap(
      ({ receipts, request }) => {
        validateReceiptsAndBlock(
          receipts,
          block,
          request,
          ethGetBlockMethod === "eth_getBlockByNumber"
            ? { method: "eth_getBlockByNumber", params: [block.number, true] }
            : { method: "eth_getBlockByHash", params: [block.hash, true] },
        );
        return receipts.filter((receipt) =>
          requiredTransactionReceipts.has(receipt.transactionHash),
        );
      },
    );

    let childAddressCount = 0;
    for (const childAddresses of blockChildAddresses.values()) {
      childAddressCount += childAddresses.size;
    }

    args.common.logger.debug(
      {
        msg: "Fetched block data",
        chain: args.chain.name,
        chain_id: args.chain.id,
        number: hexToNumber(block.number),
        hash: block.hash,
        transaction_count: transactions.length,
        log_count: logs.length,
        trace_count: traces.length,
        receipt_count: transactionReceipts.length,
        child_address_count: childAddressCount,
        duration: endClock(),
      },
      ["chain", "number", "hash"],
    );

    return {
      block,
      transactions,
      transactionReceipts,
      logs,
      traces,
      childAddresses: blockChildAddresses,
    };
  };

  /**
   * Filter the block event data using the filters and child addresses.
   */
  const filterBlockEventData = ({
    block,
    logs,
    traces,
    transactions,
    transactionReceipts,
    childAddresses: blockChildAddresses,
  }: BlockWithEventData): BlockWithEventData & {
    matchedFilters: Set<Filter>;
  } => {
    // Update `childAddresses`
    if (blockChildAddresses.size > 0) {
      for (const factory of factories) {
        const knownAddresses = childAddresses.get(factory.id)!;
        for (const fragmentId of factoryFragmentIds.get(factory)!) {
          const blockAddresses = blockChildAddresses.get(fragmentId);
          if (blockAddresses === undefined) continue;
          for (const address of blockAddresses) {
            if (knownAddresses.has(address) === false) {
              knownAddresses.set(address, hexToNumber(block.number));
            }
          }
        }
      }
    }

    // Save per block child addresses so that they can be undone in the event of a reorg.
    childAddressesPerBlock.set(hexToNumber(block.number), blockChildAddresses);

    /**
     * `logs` and `callTraces` must be filtered again (already filtered in `extract`)
     *  because `extract` doesn't have factory address information.
     */

    const matchedFilters = new Set<Filter>();

    // Remove logs that don't match a filter, accounting for factory addresses
    logs = logs.filter((log) => {
      let isMatched = false;

      for (const filter of logFilters) {
        if (
          isLogFilterMatched({ filter, log }) &&
          (isAddressFactory(filter.address)
            ? isAddressMatched({
                address: log.address,
                blockNumber: hexToNumber(block.number),
                childAddresses: childAddresses.get(filter.address.id)!,
              })
            : true)
        ) {
          matchedFilters.add(filter);
          isMatched = true;
        }
      }

      return isMatched;
    });

    traces = traces.filter((trace) => {
      let isMatched = false;
      for (const filter of transferFilters) {
        if (
          isTransferFilterMatched({
            filter,
            trace: trace.trace,
            block,
          }) &&
          (isAddressFactory(filter.fromAddress)
            ? isAddressMatched({
                address: trace.trace.from,
                blockNumber: hexToNumber(block.number),
                childAddresses: childAddresses.get(filter.fromAddress.id)!,
              })
            : true) &&
          (isAddressFactory(filter.toAddress)
            ? isAddressMatched({
                address: trace.trace.to,
                blockNumber: hexToNumber(block.number),
                childAddresses: childAddresses.get(filter.toAddress.id)!,
              })
            : true)
        ) {
          matchedFilters.add(filter);
          isMatched = true;
        }
      }

      for (const filter of traceFilters) {
        if (
          isTraceFilterMatched({
            filter,
            trace: trace.trace,
            block,
          }) &&
          (isAddressFactory(filter.fromAddress)
            ? isAddressMatched({
                address: trace.trace.from,
                blockNumber: hexToNumber(block.number),
                childAddresses: childAddresses.get(filter.fromAddress.id)!,
              })
            : true) &&
          (isAddressFactory(filter.toAddress)
            ? isAddressMatched({
                address: trace.trace.to,
                blockNumber: hexToNumber(block.number),
                childAddresses: childAddresses.get(filter.toAddress.id)!,
              })
            : true)
        ) {
          matchedFilters.add(filter);
          isMatched = true;
        }
      }

      return isMatched;
    });

    // Remove transactions and transaction receipts that may have been filtered out

    const transactionHashes = new Set<Hash>();
    for (const log of logs) {
      transactionHashes.add(log.transactionHash);
    }
    for (const trace of traces) {
      transactionHashes.add(trace.transactionHash);
    }

    transactions = transactions.filter((transaction) => {
      let isMatched = transactionHashes.has(transaction.hash);
      for (const filter of transactionFilters) {
        if (
          isTransactionFilterMatched({ filter, transaction }) &&
          (isAddressFactory(filter.fromAddress)
            ? isAddressMatched({
                address: transaction.from,
                blockNumber: hexToNumber(block.number),
                childAddresses: childAddresses.get(filter.fromAddress.id)!,
              })
            : true) &&
          (isAddressFactory(filter.toAddress)
            ? isAddressMatched({
                address: transaction.to ?? undefined,
                blockNumber: hexToNumber(block.number),
                childAddresses: childAddresses.get(filter.toAddress.id)!,
              })
            : true)
        ) {
          matchedFilters.add(filter);
          isMatched = true;
        }
      }
      return isMatched;
    });

    for (const transaction of transactions) {
      transactionHashes.add(transaction.hash);
    }

    transactionReceipts = transactionReceipts.filter((t) =>
      transactionHashes.has(t.transactionHash),
    );

    // Record matched block filters
    for (const filter of blockFilters) {
      if (isBlockFilterMatched({ filter, block })) {
        matchedFilters.add(filter);
      }
    }

    return {
      matchedFilters,
      block,
      logs,
      transactions,
      transactionReceipts,
      traces,
      childAddresses: blockChildAddresses,
    };
  };

  /**
   * Traverse the remote chain until we find a block that is
   * compatible with our local chain.
   *
   * @param block Block that caused reorg to be detected.
   * Must be at most 1 block ahead of the local chain.
   */
  const reconcileReorg = async (
    block: SyncBlock | SyncBlockHeader,
  ): Promise<Extract<RealtimeSyncEvent, { type: "reorg" }>> => {
    const context = {
      logger: args.common.logger.child({ action: "reconcile_reorg" }),
    };
    const endClock = startClock();

    args.common.logger.debug({
      msg: "Detected reorg in local chain",
      chain: args.chain.name,
      chain_id: args.chain.id,
      number: hexToNumber(block.number),
      hash: block.hash,
    });

    // Record blocks that have been removed from the local chain.
    const reorgedBlocks = unfinalizedBlocks.filter(
      (lb) => hexToNumber(lb.number) >= hexToNumber(block.number),
    );

    // Prune the local chain of blocks that have been reorged out
    unfinalizedBlocks = unfinalizedBlocks.filter(
      (lb) => hexToNumber(lb.number) < hexToNumber(block.number),
    );

    // Block we are attempting to fit into the local chain.
    let remoteBlock: LightBlock = block;

    while (true) {
      const parentBlock = getLatestUnfinalizedBlock();

      if (parentBlock.hash === remoteBlock.parentHash) break;

      if (unfinalizedBlocks.length === 0) {
        // No compatible block was found in the local chain, must be a deep reorg.

        // Note: reorgedBlocks aren't removed from `unfinalizedBlocks` because we are "bailing"
        // from this attempt to reconcile the reorg, we need to reset the local chain state back
        // to what it was before we started.
        unfinalizedBlocks = reorgedBlocks;

        args.common.logger.warn({
          msg: "Encountered unrecoverable reorg",
          chain: args.chain.name,
          chain_id: args.chain.id,
          finalized_block: hexToNumber(finalizedBlock.number),
          duration: endClock(),
        });

        throw new Error(
          `Encountered unrecoverable '${args.chain.name}' reorg beyond finalized block ${hexToNumber(finalizedBlock.number)}`,
        );
      } else {
        remoteBlock = await eth_getBlockByHash(
          args.rpc,
          [remoteBlock.parentHash, false],
          context,
        );
        // Add tip to `reorgedBlocks`
        reorgedBlocks.unshift(unfinalizedBlocks.pop()!);
      }
    }

    const commonAncestor = getLatestUnfinalizedBlock();

    args.common.logger.debug({
      msg: "Reconciled reorg in local chain",
      chain: args.chain.name,
      chain_id: args.chain.id,
      reorg_depth: reorgedBlocks.length,
      common_ancestor_block: hexToNumber(commonAncestor.number),
      duration: endClock(),
    });

    // remove reorged blocks from `childAddresses`
    removeReorgedChildAddresses(reorgedBlocks);

    return {
      type: "reorg",
      block: commonAncestor,
      reorgedBlocks,
    };
  };

  /**
   * Finish syncing a block.
   *
   * The four cases are:
   * 1) Block is the same as the one just processed, no-op.
   * 2) Block is behind the last processed. This is a sign that
   *    a reorg has occurred.
   * 3) Block is more than one ahead of the last processed,
   *    fetch all intermediate blocks and enqueue them again.
   * 4) Block is exactly one block ahead of the last processed,
   *    handle this new block (happy path).
   *
   * @dev `blockCallback` is guaranteed to be called exactly once or an error is thrown.
   * @dev It is an invariant that the correct events are generated or an error is thrown.
   */
  const reconcileBlock = async function* (
    blockWithEventData: BlockWithEventData,
    blockCallback?: (isAccepted: boolean) => void,
  ): AsyncGenerator<RealtimeSyncEvent> {
    const endClock = startClock();

    const latestBlock = getLatestUnfinalizedBlock();
    const block = blockWithEventData.block;

    // We already saw and handled this block. No-op.
    if (latestBlock.hash === block.hash) {
      args.common.logger.trace({
        msg: "Detected duplicate block",
        chain: args.chain.name,
        chain_id: args.chain.id,
        number: hexToNumber(block.number),
        hash: block.hash,
      });

      blockCallback?.(false);
      return;
    }

    // Quickly check for a reorg by comparing block numbers. If the block
    // number has not increased, a reorg must have occurred.
    if (hexToNumber(latestBlock.number) >= hexToNumber(block.number)) {
      const reorgEvent = await reconcileReorg(block);

      blockCallback?.(false);
      yield reorgEvent;
      return;
    }

    // Blocks are missing. They should be fetched and enqueued.
    if (hexToNumber(latestBlock.number) + 1 < hexToNumber(block.number)) {
      args.common.logger.trace({
        msg: "Missing blocks from local chain",
        chain: args.chain.name,
        chain_id: args.chain.id,
        block_range: JSON.stringify([
          hexToNumber(latestBlock.number) + 1,
          hexToNumber(block.number) - 1,
        ]),
      });

      // Retrieve missing blocks, but only fetch a certain amount.
      const missingBlockRange = range(
        hexToNumber(latestBlock.number) + 1,
        Math.min(
          hexToNumber(block.number),
          hexToNumber(latestBlock.number) + MAX_QUEUED_BLOCKS,
        ),
      );

      const pendingBlocks = await Promise.all(
        missingBlockRange.map((blockNumber) =>
          eth_getBlockByNumber(args.rpc, [numberToHex(blockNumber), true], {
            logger: args.common.logger.child({
              action: "fetch_missing_blocks",
            }),
          }).then((block) => fetchBlockEventData(block)),
        ),
      );

      args.common.logger.debug({
        msg: "Fetched missing blocks",
        chain: args.chain.name,
        chain_id: args.chain.id,
        block_range: JSON.stringify([
          hexToNumber(latestBlock.number) + 1,
          Math.min(
            hexToNumber(block.number) - 1,
            hexToNumber(latestBlock.number) + MAX_QUEUED_BLOCKS,
          ),
        ]),
      });

      for (const pendingBlock of pendingBlocks) {
        yield* reconcileBlock(pendingBlock);
      }

      if (
        hexToNumber(block.number) - hexToNumber(latestBlock.number) >
        MAX_QUEUED_BLOCKS
      ) {
        args.common.logger.trace({
          msg: "Latest block too far ahead of local chain",
          chain: args.chain.name,
          chain_id: args.chain.id,
          number: hexToNumber(block.number),
          hash: block.hash,
        });

        blockCallback?.(false);
      } else {
        yield* reconcileBlock(blockWithEventData, blockCallback);
      }
      return;
    }

    // Check if a reorg occurred by validating the chain of block hashes.
    if (block.parentHash !== latestBlock.hash) {
      const reorgEvent = await reconcileReorg(block);

      blockCallback?.(false);
      yield reorgEvent;
      return;
    }

    // New block is exactly one block ahead of the local chain.
    // Attempt to ingest it.

    const blockWithFilteredEventData = filterBlockEventData(blockWithEventData);

    let childAddressCount = 0;
    for (const childAddresses of blockWithFilteredEventData.childAddresses.values()) {
      childAddressCount += childAddresses.size;
    }

    args.common.logger.debug(
      {
        msg: "Added block to local chain",
        chain: args.chain.name,
        chain_id: args.chain.id,
        number: hexToNumber(block.number),
        hash: block.hash,
        transaction_count: blockWithFilteredEventData.transactions.length,
        log_count: blockWithFilteredEventData.logs.length,
        trace_count: blockWithFilteredEventData.traces.length,
        receipt_count: blockWithFilteredEventData.transactionReceipts.length,
        child_address_count: childAddressCount,
        duration: endClock(),
      },
      ["chain", "number", "hash"],
    );

    unfinalizedBlocks.push({
      hash: block.hash,
      parentHash: block.parentHash,
      number: block.number,
      timestamp: block.timestamp,
    });

    // Make sure `transactions` can be garbage collected
    blockWithEventData.block.transactions =
      blockWithFilteredEventData.transactions;

    yield {
      type: "block",
      hasMatchedFilter: blockWithFilteredEventData.matchedFilters.size > 0,
      block: blockWithFilteredEventData.block,
      logs: blockWithFilteredEventData.logs,
      transactions: blockWithFilteredEventData.transactions,
      transactionReceipts: blockWithFilteredEventData.transactionReceipts,
      traces: blockWithFilteredEventData.traces,
      childAddresses: blockWithFilteredEventData.childAddresses,
      blockCallback,
    };

    // Finalize the oldest contiguous blocks that are outside the timestamp
    // based reorg window.
    const blockMovesFinality =
      hexToNumber(block.timestamp) -
        hexToNumber(unfinalizedBlocks[0]!.timestamp) >=
      args.chain.reorgWindow;
    if (blockMovesFinality) {
      let pendingFinalizedBlock = unfinalizedBlocks[0]!;
      for (const candidate of unfinalizedBlocks) {
        if (
          hexToNumber(block.timestamp) - hexToNumber(candidate.timestamp) >=
          args.chain.reorgWindow
        ) {
          pendingFinalizedBlock = candidate;
        } else {
          break;
        }
      }

      args.common.logger.debug({
        msg: "Removed finalized blocks from local chain",
        chain: args.chain.name,
        chain_id: args.chain.id,
        block_count:
          hexToNumber(pendingFinalizedBlock.number) -
          hexToNumber(finalizedBlock.number),
        block_range: JSON.stringify([
          hexToNumber(finalizedBlock.number) + 1,
          hexToNumber(pendingFinalizedBlock.number),
        ]),
      });

      const finalizedBlocks = unfinalizedBlocks.filter(
        (lb) =>
          hexToNumber(lb.number) <= hexToNumber(pendingFinalizedBlock.number),
      );

      unfinalizedBlocks = unfinalizedBlocks.filter(
        (lb) =>
          hexToNumber(lb.number) > hexToNumber(pendingFinalizedBlock.number),
      );

      for (const block of finalizedBlocks) {
        childAddressesPerBlock.delete(hexToNumber(block.number));
      }

      finalizedBlock = pendingFinalizedBlock;

      yield {
        type: "finalize",
        block: pendingFinalizedBlock,
      };
    }
  };

  /**
   * Fetch the logs that the sources may require in `[fromBlock, toBlock]`,
   * with the requests of `rangeScanMode`.
   *
   * Requests are chunked by block range. A request rejected for being too wide
   * is split into the ranges suggested by the error and retried, and the
   * narrower range is remembered for later polls.
   *
   * @dev Logs that only a `merged` request matches, a static source's
   * `topic0` from an address no source has, are dropped here and counted to
   * decide whether to switch to `split`. They can't match a source.
   */
  const getRangeScanLogs = async (
    fromBlock: number,
    toBlock: number,
  ): Promise<{ logs: SyncLog[]; requestCount: number }> => {
    const context = {
      logger: args.common.logger.child({ action: "fetch_block_data" }),
    };

    let requestCount = 0;
    let didSplit = false;

    const mode = rangeScanMode;
    const requestFilters: { address: Address[] | undefined; topic0s: Hex[] }[] =
      [];

    if (mode === "merged") {
      requestFilters.push({
        address: undefined,
        topic0s: Array.from(
          new Set([
            ...rangeScanSources.staticTopic0s,
            ...rangeScanSources.openTopic0s,
          ]),
        ),
      });
    } else {
      const addresses = Array.from(rangeScanSources.staticAddresses);
      for (let i = 0; i < addresses.length; i += ADDRESS_CHUNK_SIZE) {
        requestFilters.push({
          address: addresses.slice(i, i + ADDRESS_CHUNK_SIZE),
          topic0s: Array.from(rangeScanSources.staticTopic0s),
        });
      }

      if (mode === "split") {
        requestFilters.push({
          address: undefined,
          topic0s: Array.from(rangeScanSources.openTopic0s),
        });
      }
    }

    const request = async (
      filter: { address: Address[] | undefined; topic0s: Hex[] },
      from: number,
      to: number,
    ): Promise<SyncLog[]> => {
      const params: Parameters<typeof eth_getLogs>[1] = [
        {
          address: filter.address,
          topics: [filter.topic0s],
          fromBlock: numberToHex(from),
          toBlock: numberToHex(to),
        },
      ];

      requestCount += 1;

      return eth_getLogs(args.rpc, params, context).catch((error) => {
        // Note: skip the range retry logic if the chain has a custom block
        // range, matching the historical sync.
        if (args.chain.ethGetLogsBlockRange !== undefined) throw error;
        if (from === to) throw error;

        const getLogsErrorResponse = getLogsRetryHelper({
          params: params as GetLogsRetryHelperParameters["params"],
          error: error as RpcError,
        });

        if (getLogsErrorResponse.shouldRetry === false) throw error;

        didSplit = true;
        isRangeScanBlockRangeConfirmed = getLogsErrorResponse.isSuggestedRange;

        const range =
          hexToNumber(getLogsErrorResponse.ranges[0]!.toBlock) -
          hexToNumber(getLogsErrorResponse.ranges[0]!.fromBlock) +
          1;

        // Remember the narrower range so that the next poll doesn't repeat the
        // same failing request.
        if (rangeScanBlockRange === undefined || range < rangeScanBlockRange) {
          rangeScanBlockRange = range;

          args.common.logger.debug({
            msg: "Updated range scan 'eth_getLogs' range",
            chain: args.chain.name,
            chain_id: args.chain.id,
            range,
          });
        }

        return Promise.all(
          getLogsErrorResponse.ranges.map(({ fromBlock, toBlock }) =>
            request(filter, hexToNumber(fromBlock), hexToNumber(toBlock)),
          ),
        ).then((logs) => logs.flat());
      });
    };

    const chunks = getChunks({
      interval: [fromBlock, toBlock],
      maxChunkSize: rangeScanBlockRange ?? toBlock - fromBlock + 1,
    });

    const results = await Promise.all(
      chunks.flatMap(([from, to]) =>
        requestFilters.map((filter) => request(filter, from, to)),
      ),
    );

    // A range narrowed from an error that didn't state a limit may be smaller
    // than the provider actually allows, and every extra chunk is an extra
    // request. Grow it back slowly, by 5% like the historical sync, and by at
    // least one block so that a small range grows too.
    if (
      didSplit === false &&
      rangeScanBlockRange !== undefined &&
      isRangeScanBlockRangeConfirmed === false &&
      args.chain.ethGetLogsBlockRange === undefined
    ) {
      rangeScanBlockRange = Math.ceil(rangeScanBlockRange * 1.05);
    }

    // Note: a `split` scan can return a log twice, from the static and the
    // open request.
    const logs: SyncLog[] = [];
    const seen = new Set<string>();
    let mergeNoiseCount = 0;

    for (const log of results.flat()) {
      if (
        mode === "merged" &&
        rangeScanSources.staticAddresses.has(toLowerCase(log.address)) ===
          false &&
        (log.topics[0] === undefined ||
          rangeScanSources.openTopic0s.has(toLowerCase(log.topics[0])) ===
            false)
      ) {
        mergeNoiseCount += 1;
        continue;
      }

      const key = `${log.blockHash}_${log.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      logs.push(log);
    }

    if (mode === "merged" && mergeNoiseCount > RANGE_SCAN_MAX_MERGE_NOISE) {
      rangeScanMode = "split";

      args.common.logger.debug({
        msg: "Switched range scan to separate 'eth_getLogs' requests for static and factory sources",
        chain: args.chain.name,
        chain_id: args.chain.id,
        unmatched_log_count: mergeNoiseCount,
      });
    }

    return { logs, requestCount };
  };

  /**
   * Build `BlockWithEventData` for a single block from logs already fetched by
   * `getRangeScanLogs` and matched against the sources.
   */
  const buildLogBlockData = async (
    block: SyncBlock,
    blockLogs: SyncLog[],
    blockChildAddresses: BlockWithEventData["childAddresses"],
    ethGetBlockMethod: "eth_getBlockByHash" | "eth_getBlockByNumber",
  ): Promise<BlockWithEventData> => {
    const context = {
      logger: args.common.logger.child({ action: "fetch_block_data" }),
    };

    const blockRequest =
      ethGetBlockMethod === "eth_getBlockByNumber"
        ? {
            method: "eth_getBlockByNumber" as const,
            params: [block.number, true] as [Hex, true],
          }
        : {
            method: "eth_getBlockByHash" as const,
            params: [block.hash, true] as [Hash, true],
          };

    validateLogsAndBlock(
      blockLogs,
      block,
      { method: "eth_getLogs", params: [{ blockHash: block.hash }] },
      blockRequest,
    );

    validateTransactionsAndBlock(block, blockRequest);

    const requiredTransactions = new Set<Hash>();
    const requiredTransactionReceipts = new Set<Hash>();

    for (const log of blockLogs) {
      if (log.transactionHash === zeroHash) continue;
      for (const filter of logFilters) {
        if (isLogFilterMatched({ filter, log })) {
          requiredTransactions.add(log.transactionHash);
          if (filter.hasTransactionReceipt) {
            requiredTransactionReceipts.add(log.transactionHash);
            break;
          }
        }
      }
    }

    const transactions = block.transactions.filter((transaction) =>
      requiredTransactions.has(transaction.hash),
    );

    const receiptResponses = await eth_getTransactionReceipts(
      args.rpc,
      { blockHash: block.hash, transactionHashes: requiredTransactionReceipts },
      context,
    );
    const transactionReceipts = receiptResponses.flatMap(
      ({ receipts, request }) => {
        validateReceiptsAndBlock(receipts, block, request, blockRequest);
        return receipts.filter((receipt) =>
          requiredTransactionReceipts.has(receipt.transactionHash),
        );
      },
    );

    return {
      block,
      transactions,
      transactionReceipts,
      logs: blockLogs,
      traces: [],
      childAddresses: blockChildAddresses,
    };
  };

  /**
   * Reconcile the chain up to `headBlock` by scanning the entire unfinalized
   * window with ranged `eth_getLogs` requests. Reorgs are detected by diffing
   * the block hashes reported by the rescan against the blocks the scan has
   * already processed, so blocks without matching events are never fetched.
   *
   * @dev Only used when `canRangeScan` is true.
   */
  const reconcileRange = async function* (
    headBlock: SyncBlock | SyncBlockHeader,
    blockCallback?: (isAccepted: boolean) => void,
  ): AsyncGenerator<RealtimeSyncEvent> {
    const endClock = startClock();
    const headNumber = hexToNumber(headBlock.number);
    const windowFrom = hexToNumber(finalizedBlock.number) + 1;

    const tipNumberBeforeScan = hexToNumber(getLatestUnfinalizedBlock().number);

    // We already saw this head, or it is at/under the finalized block. No-op.
    if (
      getLatestUnfinalizedBlock().hash === headBlock.hash ||
      headNumber < windowFrom
    ) {
      recordRangeScanPoll({ blocks: 0, requests: 0, matchedBlocks: 0 });
      blockCallback?.(false);
      return;
    }

    // Forget the blocks recorded above the local tip, so that this scan
    // examines them again. None of them was emitted: a poll that rewinds the
    // tip below a recorded block and then fails leaves it there. Later scans
    // would treat it as processed, and a factory child's log in it would never
    // match once a scan returns the child's creation log.
    for (const number of scannedBlocks.keys()) {
      if (number > tipNumberBeforeScan) scannedBlocks.delete(number);
    }

    // Scan the entire unfinalized window. Used both for reorg detection
    // (comparing block hashes against the blocks already processed) and to
    // discover new blocks with logs.
    const { logs: rangeLogs, requestCount } = await getRangeScanLogs(
      windowFrom,
      headNumber,
    );

    const logsByBlockNumber = new Map<
      number,
      { hash: Hash; logs: SyncLog[] }
    >();
    for (const log of rangeLogs) {
      const number = hexToNumber(log.blockNumber);
      const entry = logsByBlockNumber.get(number);
      if (entry === undefined) {
        logsByBlockNumber.set(number, { hash: log.blockHash, logs: [log] });
      } else if (entry.hash !== log.blockHash) {
        // Note: only possible across requests that observed different chains,
        // for example a reorg between the `split` requests. Retried next poll.
        throw new Error(
          `Inconsistent 'eth_getLogs' responses: block ${number} reported with hashes ${entry.hash} and ${log.blockHash}`,
        );
      } else {
        entry.logs.push(log);
      }
    }

    // Logs from different requests arrive out of order.
    for (const { logs } of logsByBlockNumber.values()) {
      logs.sort((a, b) => hexToNumber(a.logIndex) - hexToNumber(b.logIndex));
    }

    // The scan observed a different chain than the poll that returned the
    // head. Retried next poll.
    const scannedHead = logsByBlockNumber.get(headNumber);
    if (scannedHead !== undefined && scannedHead.hash !== headBlock.hash) {
      throw new Error(
        `Inconsistent RPC responses: head block ${headNumber} has hash ${headBlock.hash}, but 'eth_getLogs' reported ${scannedHead.hash}`,
      );
    }

    // A block with a notified log that the scan reaches without returning any
    // log for it: the node answering `eth_getLogs` is behind the node that
    // sent the notification. The scan is rejected rather than move the head
    // past the event, then accepted after `LOG_TRIGGER_MAX_REJECTIONS`, as the
    // block may have been reorged out.
    for (const [hash, expected] of expectedLogBlocks) {
      if (
        expected.number < windowFrom ||
        logsByBlockNumber.has(expected.number) ||
        expected.rejections === LOG_TRIGGER_MAX_REJECTIONS
      ) {
        expectedLogBlocks.delete(hash);
      } else if (expected.number <= headNumber) {
        expected.rejections += 1;
        throw new Error(
          `Inconsistent RPC responses: block ${expected.number} has a notified log, but 'eth_getLogs' returned no log for it`,
        );
      }
    }

    /** `true` if the block and all of its scanned logs were processed. */
    const isScanned = (number: number) => {
      const { hash, logs } = logsByBlockNumber.get(number)!;
      const scanned = scannedBlocks.get(number);
      return (
        scanned !== undefined &&
        scanned.hash === hash &&
        logs.every((log) => scanned.logIndexes.has(hexToNumber(log.logIndex)))
      );
    };

    const recordScanned = (number: number) => {
      const { hash, logs } = logsByBlockNumber.get(number)!;
      scannedBlocks.set(number, {
        hash,
        logIndexes: new Set(logs.map((log) => hexToNumber(log.logIndex))),
      });
    };

    // --- Reorg detection ---
    // Find the lowest block at or below the local tip where the rescan
    // disagrees with what has already been processed. Four cases, all of
    // which must rewind:
    //
    // 1. A processed block has a different hash in the rescan.
    // 2. A processed block that had logs no longer has any.
    // 3. A block that previously had no logs now has some. This is the case
    //    that a processed-blocks-only diff misses: because the head is emitted
    //    as an empty block every poll, the local tip advances past event-free
    //    blocks, and logs introduced into them by a reorg would otherwise never
    //    be ingested.
    // 4. A processed block has a log at the same hash that an earlier scan
    //    didn't return. One of that scan's requests missed it, because its
    //    node was behind or because of a reorg between the requests.
    //
    // Note: blocks above the head are not compared, because the scan stops at
    // the head. A head below the local tip (a provider node behind the others)
    // otherwise looks like case 2.
    const compareToNumber = Math.min(tipNumberBeforeScan, headNumber);

    let reorgFromNumber: number | undefined;
    const setReorgFrom = (number: number) => {
      if (reorgFromNumber === undefined || number < reorgFromNumber) {
        reorgFromNumber = number;
      }
    };

    for (const [number, { hash }] of scannedBlocks) {
      if (number > compareToNumber) continue;
      if (logsByBlockNumber.get(number)?.hash !== hash) setReorgFrom(number);
    }
    for (const number of logsByBlockNumber.keys()) {
      if (number > compareToNumber) continue;
      if (isScanned(number) === false) setReorgFrom(number);
    }

    // The head itself may be a reorged replacement of a block that was already
    // emitted, or may not descend from the local tip. Both are free to check.
    const storedHeadHash = unfinalizedBlocks.find(
      (lb) => hexToNumber(lb.number) === headNumber,
    )?.hash;
    if (storedHeadHash !== undefined && storedHeadHash !== headBlock.hash) {
      setReorgFrom(headNumber);
    } else if (
      headNumber === tipNumberBeforeScan + 1 &&
      headBlock.parentHash !== getLatestUnfinalizedBlock().hash
    ) {
      if (unfinalizedBlocks.length === 0) {
        // The local chain is empty, so the head's parent is the finalized
        // block. A mismatch means the reorg is beyond the finalized block.
        args.common.logger.warn({
          msg: "Encountered unrecoverable reorg",
          chain: args.chain.name,
          chain_id: args.chain.id,
          finalized_block: hexToNumber(finalizedBlock.number),
          duration: endClock(),
        });

        throw new Error(
          `Encountered unrecoverable '${args.chain.name}' reorg beyond finalized block ${hexToNumber(finalizedBlock.number)}`,
        );
      }

      setReorgFrom(tipNumberBeforeScan);
    }

    if (reorgFromNumber !== undefined) {
      const reorgedBlocks = unfinalizedBlocks.filter(
        (lb) => hexToNumber(lb.number) >= reorgFromNumber!,
      );
      unfinalizedBlocks = unfinalizedBlocks.filter(
        (lb) => hexToNumber(lb.number) < reorgFromNumber!,
      );
      removeReorgedChildAddresses(reorgedBlocks);
      // Forget every scanned block at or above the fork point so that the
      // replacement blocks are ingested below rather than treated as seen.
      for (const number of scannedBlocks.keys()) {
        if (number >= reorgFromNumber) scannedBlocks.delete(number);
      }

      const commonAncestor = getLatestUnfinalizedBlock();

      args.common.logger.debug({
        msg: "Reconciled reorg in local chain",
        chain: args.chain.name,
        chain_id: args.chain.id,
        reorg_depth: reorgedBlocks.length,
        common_ancestor_block: hexToNumber(commonAncestor.number),
      });

      yield { type: "reorg", block: commonAncestor, reorgedBlocks };
    }

    // --- Match new blocks ---
    // Every block in the scan that hasn't already been processed at this hash,
    // in ascending order. Blocks below the tip are unchanged in the common case
    // (their hash is already recorded), but a reorg rewinds above them.
    const newNumbers = Array.from(logsByBlockNumber.keys())
      .filter((number) => number <= headNumber && isScanned(number) === false)
      .sort((a, b) => a - b);

    // Child addresses created by blocks of this scan, so that later blocks of
    // the same scan match their logs before the creating block is ingested.
    const scanChildAddresses = new Map<FactoryId, Map<Address, number>>();
    const isFactoryAddressMatched = (
      factory: Factory,
      address: Address,
      blockNumber: number,
    ) =>
      isAddressMatched({
        address,
        blockNumber,
        childAddresses: childAddresses.get(factory.id)!,
      }) ||
      isAddressMatched({
        address,
        blockNumber,
        childAddresses: scanChildAddresses.get(factory.id) ?? new Map(),
      });

    const pendingBlocks: {
      number: number;
      hash: Hash;
      logs: SyncLog[];
      childAddresses: BlockWithEventData["childAddresses"];
    }[] = [];
    /** Blocks without matched logs or child addresses, which aren't fetched. */
    const unmatchedNumbers: number[] = [];

    for (const number of newNumbers) {
      const { hash, logs } = logsByBlockNumber.get(number)!;
      const { childAddresses: blockChildAddresses } =
        getBlockChildAddresses(logs);

      for (const factory of factories) {
        for (const fragmentId of factoryFragmentIds.get(factory)!) {
          const blockAddresses = blockChildAddresses.get(fragmentId);
          if (blockAddresses === undefined) continue;
          if (scanChildAddresses.has(factory.id) === false) {
            scanChildAddresses.set(factory.id, new Map());
          }
          const scanAddresses = scanChildAddresses.get(factory.id)!;
          for (const address of blockAddresses) {
            if (scanAddresses.has(address) === false) {
              scanAddresses.set(address, number);
            }
          }
        }
      }

      const matchedLogs = logs.filter((log) =>
        logFilters.some(
          (filter) =>
            isLogFilterMatched({ filter, log }) &&
            (isAddressFactory(filter.address)
              ? isFactoryAddressMatched(filter.address, log.address, number)
              : true),
        ),
      );

      if (matchedLogs.length === 0 && blockChildAddresses.size === 0) {
        unmatchedNumbers.push(number);
        continue;
      }

      pendingBlocks.push({
        number,
        hash,
        logs: matchedLogs,
        childAddresses: blockChildAddresses,
      });
    }

    recordRangeScanPoll({
      blocks: Math.max(headNumber - tipNumberBeforeScan, 0),
      requests: requestCount,
      matchedBlocks: pendingBlocks.length,
      head: headBlock,
    });

    const pendingBlocksWithEventData = await Promise.all(
      pendingBlocks.map(async (pending) => {
        // Note: the head from a polling subscription already has transactions.
        if (
          pending.hash === headBlock.hash &&
          headBlock.transactions !== undefined
        ) {
          return buildLogBlockData(
            headBlock,
            pending.logs,
            pending.childAddresses,
            "eth_getBlockByNumber",
          );
        }

        const block = await eth_getBlockByHash(args.rpc, [pending.hash, true], {
          logger: args.common.logger.child({ action: "fetch_block_data" }),
        });

        return buildLogBlockData(
          block,
          pending.logs,
          pending.childAddresses,
          "eth_getBlockByHash",
        );
      }),
    );

    // Blocks without matched logs or child addresses are recorded without
    // being fetched. They must still be recorded, otherwise they would look
    // like a reorg on every later poll. Like the fetched blocks, they are
    // recorded only once the fetches succeed, so a failed poll records nothing.
    for (const number of unmatchedNumbers) recordScanned(number);

    const blockEvents: Extract<RealtimeSyncEvent, { type: "block" }>[] = [];

    for (const blockWithEventData of pendingBlocksWithEventData) {
      // Note: adds the block's child addresses to `childAddresses`.
      const filtered = filterBlockEventData(blockWithEventData);
      const block = filtered.block;
      const number = hexToNumber(block.number);

      // Note: recorded after the fetch succeeds, so that a failed poll is
      // retried from scratch rather than skipping the block.
      recordScanned(number);

      if (
        filtered.matchedFilters.size === 0 &&
        filtered.childAddresses.size === 0
      ) {
        childAddressesPerBlock.delete(number);
        continue;
      }

      unfinalizedBlocks.push({
        hash: block.hash,
        parentHash: block.parentHash,
        number: block.number,
        timestamp: block.timestamp,
      });

      // Make sure `transactions` can be garbage collected
      blockWithEventData.block.transactions = filtered.transactions;

      blockEvents.push({
        type: "block",
        hasMatchedFilter: filtered.matchedFilters.size > 0,
        block: filtered.block,
        logs: filtered.logs,
        transactions: filtered.transactions,
        transactionReceipts: filtered.transactionReceipts,
        traces: filtered.traces,
        childAddresses: filtered.childAddresses,
      });
    }

    // --- Advance to the head block ---
    // Emit the head as an empty block (if it wasn't already emitted as matched)
    // so the realtime checkpoint advances to the tip every poll.
    //
    // @dev These blocks are not added to `scannedBlocks`, because the scan
    // never observed them — they contain no logs. A reorg that replaces a
    // log-free head with another log-free block is therefore not detected, and
    // `syncProgress.current` can briefly hold a non-canonical hash and
    // timestamp. No events are affected: `hasMatchedFilter: false` blocks are
    // never persisted, and the next poll's scan re-derives the tip. A reorg
    // that gives any of these blocks a log *is* detected, by case 3 above.
    if (hexToNumber(getLatestUnfinalizedBlock().number) < headNumber) {
      unfinalizedBlocks.push({
        hash: headBlock.hash,
        parentHash: headBlock.parentHash,
        number: headBlock.number,
        timestamp: headBlock.timestamp,
      });
      childAddressesPerBlock.set(headNumber, new Map());

      blockEvents.push({
        type: "block",
        hasMatchedFilter: false,
        // Note: no transactions are needed, and dropping them lets them be
        // garbage collected.
        block:
          headBlock.transactions === undefined
            ? headBlock
            : { ...headBlock, transactions: [] },
        logs: [],
        transactions: [],
        transactionReceipts: [],
        traces: [],
        childAddresses: new Map(),
      });
    }

    // `blockCallback` signals that the head has been fully processed. It must be
    // attached to the last emitted block event so that the runtime calls it
    // *after* indexing that block's events, exactly as `reconcileBlock` does.
    // Calling it here instead reports completion while events are still pending,
    // which drops them when the chain reaches its end block.
    if (blockEvents.length === 0) {
      blockCallback?.(false);
    } else {
      for (const [index, blockEvent] of blockEvents.entries()) {
        yield index === blockEvents.length - 1
          ? { ...blockEvent, blockCallback }
          : blockEvent;
      }
    }

    args.common.logger.debug(
      {
        msg: "Reconciled range",
        chain: args.chain.name,
        chain_id: args.chain.id,
        block_range: JSON.stringify([windowFrom, headNumber]),
        matched_block_count: pendingBlocks.length,
        request_count: requestCount,
        duration: endClock(),
      },
      ["chain"],
    );

    // --- Finalization ---
    // Finalize the local blocks that are outside the timestamp based reorg
    // window, as `reconcileBlock` does. The local chain is sparse on this path,
    // so this finalizes to the newest local block outside the window rather
    // than to the window boundary. That is always safe, and a head block is
    // appended every poll, so the window stays bounded.
    if (unfinalizedBlocks.length === 0) return;

    const latestTimestamp = hexToNumber(getLatestUnfinalizedBlock().timestamp);

    if (
      latestTimestamp - hexToNumber(unfinalizedBlocks[0]!.timestamp) <
      args.chain.reorgWindow
    ) {
      return;
    }

    let pendingFinalizedBlock = unfinalizedBlocks[0]!;
    for (const candidate of unfinalizedBlocks) {
      if (
        latestTimestamp - hexToNumber(candidate.timestamp) >=
        args.chain.reorgWindow
      ) {
        pendingFinalizedBlock = candidate;
      } else {
        break;
      }
    }

    const finalizedNumber = hexToNumber(pendingFinalizedBlock.number);

    args.common.logger.debug({
      msg: "Removed finalized blocks from local chain",
      chain: args.chain.name,
      chain_id: args.chain.id,
      block_count: finalizedNumber - hexToNumber(finalizedBlock.number),
      block_range: JSON.stringify([
        hexToNumber(finalizedBlock.number) + 1,
        finalizedNumber,
      ]),
    });

    const finalizedBlocks = unfinalizedBlocks.filter(
      (lb) => hexToNumber(lb.number) <= finalizedNumber,
    );
    unfinalizedBlocks = unfinalizedBlocks.filter(
      (lb) => hexToNumber(lb.number) > finalizedNumber,
    );
    for (const block of finalizedBlocks) {
      childAddressesPerBlock.delete(hexToNumber(block.number));
    }
    for (const number of scannedBlocks.keys()) {
      if (number <= finalizedNumber) scannedBlocks.delete(number);
    }

    finalizedBlock = pendingFinalizedBlock;

    yield { type: "finalize", block: pendingFinalizedBlock };
  };

  const onError = (error: Error, block?: SyncBlock | SyncBlockHeader) => {
    if (args.common.shutdown.isKilled) {
      throw new ShutdownError();
    }

    if (block) {
      args.common.logger.warn({
        msg: "Failed to fetch latest block",
        chain: args.chain.name,
        chain_id: args.chain.id,
        number: hexToNumber(block.number),
        hash: block.hash,
        retry_count: fetchAndReconcileLatestBlockErrorCount,
        error,
      });
    } else {
      args.common.logger.warn({
        msg: "Failed to fetch latest block",
        chain: args.chain.name,
        chain_id: args.chain.id,
        retry_count: fetchAndReconcileLatestBlockErrorCount,
        error,
      });
    }

    fetchAndReconcileLatestBlockErrorCount += 1;
    firstLatestBlockErrorAt ??= Date.now();

    // Number of retries is max(10, `MAX_LATEST_BLOCK_ATTEMPT_MS` / `args.chain.pollingInterval`).
    // A range scan measures `MAX_LATEST_BLOCK_ATTEMPT_MS` in time instead, as
    // its attempts can be a heartbeat apart rather than `pollingInterval`.
    if (
      fetchAndReconcileLatestBlockErrorCount >= 10 &&
      (canRangeScan
        ? Date.now() - firstLatestBlockErrorAt > MAX_LATEST_BLOCK_ATTEMPT_MS
        : fetchAndReconcileLatestBlockErrorCount * args.chain.pollingInterval >
          MAX_LATEST_BLOCK_ATTEMPT_MS)
    ) {
      throw error;
    }
  };

  return {
    async *sync(block, blockCallback) {
      try {
        args.common.logger.debug({
          msg: "Received new head block",
          chain: args.chain.name,
          chain_id: args.chain.id,
          number: hexToNumber(block.number),
          hash: block.hash,
        });

        const latestBlock = getLatestUnfinalizedBlock();

        // We already saw and handled this block. No-op.
        if (
          latestBlock.hash === block.hash ||
          latestFetchedBlock?.hash === block.hash
        ) {
          args.common.logger.trace({
            msg: "Detected duplicate block",
            chain: args.chain.name,
            chain_id: args.chain.id,
            number: hexToNumber(block.number),
            hash: block.hash,
          });
          blockCallback?.(false);

          return;
        }

        // Note: It's possible that a block with the same hash as `block` is
        // currently being fetched but hasn't been fully reconciled. `latestFetchedBlock`
        // is used to handle this case.

        latestFetchedBlock = block;

        if (canRangeScan) {
          // Note: reconciliation must be called serially.
          await realtimeSyncLock.lock();

          try {
            yield* reconcileRange(block, blockCallback);
          } finally {
            realtimeSyncLock.unlock();
          }

          latestFetchedBlock = undefined;
          fetchAndReconcileLatestBlockErrorCount = 0;
          firstLatestBlockErrorAt = undefined;
          return;
        }

        const blockWithEventData = await fetchBlockEventData(block);

        // Note: `reconcileBlock` must be called serially.

        await realtimeSyncLock.lock();

        try {
          yield* reconcileBlock(blockWithEventData, blockCallback);
        } finally {
          realtimeSyncLock.unlock();
        }

        latestFetchedBlock = undefined;

        fetchAndReconcileLatestBlockErrorCount = 0;
        firstLatestBlockErrorAt = undefined;
      } catch (_error) {
        // Note: a failed scan is retried by the next poll, even at the same
        // head, as nothing of it was reconciled.
        if (canRangeScan) latestFetchedBlock = undefined;
        blockCallback?.(false);
        onError(_error as Error, block);
      }
    },
    onError,
    get unfinalizedBlocks() {
      return unfinalizedBlocks;
    },
    isRangeScan: canRangeScan,
    logTrigger,
  };
};
