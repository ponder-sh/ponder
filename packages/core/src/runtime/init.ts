import type { Database } from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import type {
  Chain,
  EventCallback,
  IndexingBuild,
  RawEvent,
} from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
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
    "eventCallbacks" | "chains" | "rpcs" | "finalizedBlocks"
  >;
  chain: Chain;
  rpc: Rpc;
  eventCallbacks: EventCallback[];
  childAddresses: ChildAddresses;
  syncProgress: SyncProgress;
  cachedIntervals: CachedIntervals;
  from: string;
  to: string;
  limit: number;
  database: Database;
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
