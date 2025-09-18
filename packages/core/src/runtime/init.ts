import type { Common } from "@/internal/common.js";
import type {
  Chain,
  IndexingBuild,
  RawEvent,
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

export async function initRefetchEvents(
  params: Parameters<typeof refetchLocalEvents>[0],
): Promise<RawEvent[]> {
  return refetchLocalEvents(params);
}

export async function initSyncProgress(
  params: Parameters<typeof getLocalSyncProgress>[0],
): Promise<SyncProgress> {
  return getLocalSyncProgress(params);
}
