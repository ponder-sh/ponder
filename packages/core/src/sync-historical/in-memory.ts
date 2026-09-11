import type { Common } from "@/internal/common.js";
import type { Chain } from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import type {
  ChildAddresses,
  IntervalWithFactory,
  IntervalWithFilter,
} from "@/runtime/index.js";
import type { SyncStore } from "@/sync-store/index.js";

export type InMemoryHistoricalSync = {
  syncBlockData(params: {
    requiredIntervals: IntervalWithFilter[];
    requiredFactoryIntervals: IntervalWithFactory[];
  }): AsyncGenerator<Awaited<ReturnType<SyncStore["getEventData"]>>>;
};

export function createInMemoryHistoricalSync(params: {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  childAddress: ChildAddresses;
}): InMemoryHistoricalSync {
  return {
    async *syncBlockData() {},
  };
}
