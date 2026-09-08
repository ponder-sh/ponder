/**
 * The sync engine, on its own.
 *
 * Ponder's backfill and realtime sync are written against the {@link SyncStore}
 * type and nothing else, so an application that already has its own database
 * can drive them directly: implement `SyncStore` over your own tables, hand it
 * to {@link createHistoricalSync}, and handle {@link RealtimeSyncEvent} rather
 * than writing indexing functions.
 *
 * What that gets you is the part that is tedious to get right: `eth_getLogs`
 * range estimation and error recovery, interval bookkeeping so a restart does
 * not refetch, factory child-address discovery, block-hash reorg detection with
 * finality tracking, and the rpc request cache.
 *
 * Nothing reachable from this module imports Drizzle, `pg`, PGlite, Hono, or
 * the CLI -- `internal/layering.test.ts` fails if that changes.
 */

// A `Common` is the engine's ambient services. Build one with these.
export type { Common } from "@/internal/common.js";
export {
  createLogger,
  createNoopLogger,
  type Logger,
} from "@/internal/logger.js";
export { MetricsService } from "@/internal/metrics.js";
export {
  buildOptions,
  type CliOptions,
  type Options,
} from "@/internal/options.js";
export { createShutdown, type Shutdown } from "@/internal/shutdown.js";
// The data model the engine is written in terms of.
export type {
  BlockFilter,
  Chain,
  EventCallback,
  Factory,
  Filter,
  FilterAddress,
  Fragment,
  FragmentId,
  LightBlock,
  LogFactory,
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
export {
  createRpc,
  type RequestParameters,
  type RequestReturnType,
  type Rpc,
} from "@/rpc/index.js";
// Deciding whether a filter matches, and how filters map onto cache fragments.
export {
  getFilterFactories,
  getFilterFromBlock,
  getFilterToBlock,
  isAddressFactory,
  isBlockFilterMatched,
  isBlockInFilter,
  isLogFactoryMatched,
  isLogFilterMatched,
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
} from "@/runtime/filter.js";
export {
  decodeFragment,
  encodeFragment,
  getFactoryFragments,
  getFragments,
  recoverFilter,
} from "@/runtime/fragments.js";
// Progress and interval bookkeeping, for driving the engine over a range.
export {
  type CachedIntervals,
  type ChildAddresses,
  getCachedBlock,
  getCachedIntervals,
  getChildAddresses,
  getLocalSyncProgress,
  getRequiredIntervals,
  type IntervalWithFactory,
  type IntervalWithFilter,
  type SyncProgress,
} from "@/runtime/index.js";
export {
  createHistoricalSync,
  type HistoricalSync,
} from "@/sync-historical/index.js";
export {
  type BlockWithEventData,
  createRealtimeSync,
  type RealtimeSync,
  type RealtimeSyncEvent,
} from "@/sync-realtime/index.js";
// The storage contract. `createSyncStore` in `@/sync-store/index.js` is
// Ponder's own implementation of it, over Postgres and PGlite; it is
// deliberately not exported here, because depending on it would mean
// depending on Drizzle.
export type { SyncStore } from "@/sync-store/store.js";

export {
  getChunks,
  type Interval,
  intervalBounds,
  intervalDifference,
  intervalIntersection,
  intervalIntersectionMany,
  intervalRange,
  intervalSum,
  intervalUnion,
  sortIntervals,
} from "@/utils/interval.js";
