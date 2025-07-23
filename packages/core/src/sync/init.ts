import type { Common } from "@/internal/common.js";
import type {
  Chain,
  Event,
  LightBlock,
  RawEvent,
  Source,
} from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import type { HistoricalSync } from "@/sync-historical/index.js";
import { type SyncProgress, getLocalSyncProgress } from "./sync.js";

type RawEventGenerator = AsyncGenerator<{
  events: RawEvent[];
  checkpoint: string;
}>;

type EventGenerator = AsyncGenerator<{
  events: Event[];
  checkpoint: string;
}>;

export async function initGenerator(params: {
  getLocalGenerator: () => Promise<RawEventGenerator>;
  decodeEventGenerator: (generator: RawEventGenerator) => EventGenerator;
  sortCrashRecoveryEvents: (generator: EventGenerator) => EventGenerator;
}) {
  const { getLocalGenerator, decodeEventGenerator, sortCrashRecoveryEvents } =
    params;

  const generator = await getLocalGenerator();
  return sortCrashRecoveryEvents(decodeEventGenerator(generator));
}

export async function initSyncProgress(params: {
  common: Common;
  chain: Chain;
  sources: Source[];
  rpc: Rpc;
  finalizedBlock: LightBlock;
  historicalSync: HistoricalSync;
}): Promise<SyncProgress> {
  const { common, chain, sources, rpc, finalizedBlock, historicalSync } =
    params;

  const syncProgress = await getLocalSyncProgress({
    common: common,
    chain,
    sources,
    rpc,
    finalizedBlock,
    intervalsCache: historicalSync.intervalsCache,
  });

  return syncProgress;
}
