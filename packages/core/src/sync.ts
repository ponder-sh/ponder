/**
 * `ponder/sync` — public extension API for custom sync providers.
 *
 * Implement {@link HistoricalSyncFactory} (and, in the future,
 * {@link RealtimeSyncFactory}) in your own package and wire it via `chain.sync`
 * in `ponder.config.ts` to back Ponder's sync with a custom data source instead
 * of JSON-RPC.
 *
 * This module exposes the complete contract a provider needs: the `HistoricalSync`
 * interface, the internal `Sync*` data types to produce, the `SyncStore` to write
 * them to, the per-interval `Filter`/`Factory` inputs, and helpers for factory
 * child discovery and block-interval math — so a provider never has to deep-import
 * `@/...` internals or re-declare core's shapes.
 *
 * Stability: this is a lower-level surface than the main `ponder` entrypoint. It is
 * versioned with `ponder` and may change in minor releases; pin accordingly.
 *
 * @example
 * ```ts
 * import type { HistoricalSyncFactory } from "ponder/sync";
 *
 * export const myProvider = (opts: { url: string }): HistoricalSyncFactory =>
 *   (args) => ({
 *     async syncBlockRangeData({ interval, requiredIntervals, syncStore }) {
 *       // fetch a range, write Sync* via syncStore, return matched SyncLog[]
 *     },
 *     async syncBlockData({ interval, logs, syncStore }) {
 *       // finalize per-block data, return the tip SyncBlock | undefined
 *     },
 *   });
 * ```
 */

// Sync contracts + default (RPC) implementations (for composition / gap fallback)
export {
  createHistoricalSync,
  type HistoricalSync,
  type HistoricalSyncFactory,
  type CreateHistoricalSyncParameters,
} from "@/sync-historical/index.js";
export {
  createRealtimeSync,
  type RealtimeSync,
  type RealtimeSyncFactory,
  type CreateRealtimeSyncParameters,
  type RealtimeSyncEvent,
  type BlockWithEventData,
} from "@/sync-realtime/index.js";

// Chain + sync descriptor + internal data types a provider produces
export type {
  Chain,
  ChainSync,
  EventCallback,
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTransaction,
  SyncTransactionReceipt,
  SyncTrace,
  LightBlock,
  Filter,
  LogFilter,
  TraceFilter,
  TransferFilter,
  BlockFilter,
  TransactionFilter,
  Factory,
  FactoryId,
} from "@/internal/types.js";

// Per-interval filter inputs + sync progress passed to a provider
export type {
  IntervalWithFilter,
  IntervalWithFactory,
  SyncProgress,
  ChildAddresses,
} from "@/runtime/index.js";

// Filter helpers (factory child discovery + per-filter-type matching)
export {
  getChildAddress,
  isAddressFactory,
  isAddressMatched,
  isBlockFilterMatched,
  isLogFactoryMatched,
  isLogFilterMatched,
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
} from "@/runtime/filter.js";

// Block-interval type + utilities
export {
  type Interval,
  getChunks,
  intervalBounds,
  intervalDifference,
  intervalIntersection,
  intervalIntersectionMany,
  intervalRange,
  intervalSum,
  intervalUnion,
  sortIntervals,
} from "@/utils/interval.js";

// Transport, write side, and context
export type { Rpc } from "@/rpc/index.js";
export type { SyncStore } from "@/sync-store/index.js";
export type { Common } from "@/internal/common.js";
