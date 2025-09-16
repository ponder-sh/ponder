import type { Common } from "@/internal/common.js";
import type {
  Chain,
  Event,
  IndexingBuild,
  LightBlock,
  Source,
} from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import { getLocalEventGenerator, refetchLocalEvents } from "./historical.js";
import {
  type CachedIntervals,
  type ChildAddresses,
  type SyncProgress,
  getLocalSyncProgress,
} from "./index.js";

export async function initEventGenerator(params: {
  common: Common;
  indexingBuild: Pick<
    IndexingBuild,
    "sources" | "chains" | "rpcs" | "finalizedBlocks"
  >;
  chain: Chain;
  rpc: Rpc;
  sources: Source[];
  childAddresses: ChildAddresses;
  syncProgress: SyncProgress;
  cachedIntervals: CachedIntervals;
  from: string;
  to: string;
  limit: number;
  syncStore: SyncStore;
  isCatchup: boolean;
}) {
  return getLocalEventGenerator(params);
}

export async function initRefetchEvents(params: {
  common: Common;
  chain: Chain;
  childAddresses: ChildAddresses;
  sources: Source[];
  events: Event[];
  syncStore: SyncStore;
}) {
  return refetchLocalEvents(params);
}

export function initSyncProgress(params: {
  common: Common;
  sources: Source[];
  chain: Chain;
  rpc: Rpc;
  finalizedBlock: LightBlock;
  cachedIntervals: CachedIntervals;
}) {
  return getLocalSyncProgress(params);
}
