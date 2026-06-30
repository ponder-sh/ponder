import { createConfig } from "@/config/index.js";
// The provider contract, imported entirely from the public extension surface.
// In-repo this is the `@/sync.js` alias; externally it is `ponder/sync`.
import {
  type BlockFilter,
  type CreateHistoricalSyncParameters,
  type Factory,
  type HistoricalSync,
  type HistoricalSyncFactory,
  type LogFilter,
  type SyncBlock,
  type SyncLog,
  type SyncStore,
  type SyncTrace,
  type SyncTransaction,
  type TraceFilter,
  type TransactionFilter,
  type TransferFilter,
  getChildAddress,
  isAddressFactory,
  isAddressMatched,
  isBlockFilterMatched,
  isLogFactoryMatched,
  isLogFilterMatched,
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
} from "@/sync.js";
import { http, type Address } from "viem";
import { test } from "vitest";

// A historical-sync provider implemented using ONLY the exported contract —
// no `@/...` deep imports, no re-declared core shapes. This is the whole point
// of `ponder/sync`: the surface is complete enough to build a provider against.
const provider: HistoricalSyncFactory = (
  args: CreateHistoricalSyncParameters,
): HistoricalSync => {
  // `args` carries everything a provider needs (common / chain / rpc / childAddresses).
  args.chain.id;
  args.childAddresses.size;
  return {
    async syncBlockRangeData(params) {
      params.interval satisfies [number, number];
      params.syncStore satisfies SyncStore;
      return [] as SyncLog[];
    },
    async syncBlockData(params) {
      params.logs satisfies SyncLog[];
      return undefined as SyncBlock | undefined;
    },
  };
};

// Ambient samples for the full-filter coverage below. They are never evaluated
// at runtime: the provider methods that reference them are constructed but never
// invoked (createConfig stores the factory without calling it).
declare const sampleLog: SyncLog;
declare const sampleTrace: SyncTrace["trace"];
declare const sampleTransaction: SyncTransaction;
declare const sampleBlock: Pick<SyncBlock, "number">;
declare const logFilter: LogFilter;
declare const blockFilter: BlockFilter;
declare const transactionFilter: TransactionFilter;
declare const traceFilter: TraceFilter;
declare const transferFilter: TransferFilter;

// A provider that handles EVERY source type (log / block / transaction / trace /
// transfer, plus factories). It exercises the full matcher surface so that
// dropping any per-filter-type helper from `ponder/sync` breaks the build
// instead of silently regressing a non-log provider that can no longer route
// those sources without deep imports.
const fullFilterProvider: HistoricalSyncFactory = (
  args: CreateHistoricalSyncParameters,
): HistoricalSync => ({
  async syncBlockRangeData(params) {
    // Per-interval filter inputs are a discriminated union on `filter.type`, and
    // the factory intervals carry the `Factory` shape — all from the surface.
    for (const { filter, interval } of params.requiredIntervals) {
      interval satisfies [number, number];
      if (filter.type === "log") {
        filter satisfies LogFilter;
      } else if (filter.type === "block") {
        filter satisfies BlockFilter;
      } else if (filter.type === "transaction") {
        filter satisfies TransactionFilter;
      } else if (filter.type === "trace") {
        filter satisfies TraceFilter;
      } else if (filter.type === "transfer") {
        filter satisfies TransferFilter;
      }
    }
    for (const { factory, interval } of params.requiredFactoryIntervals) {
      interval satisfies [number, number];
      factory satisfies Factory;
      args.childAddresses.get(factory.id);
    }
    return [] as SyncLog[];
  },
  async syncBlockData(params) {
    params.logs satisfies SyncLog[];

    // Every matcher a non-log provider needs must remain a value export.
    if (isAddressFactory(logFilter.address)) {
      getChildAddress({ log: sampleLog, factory: logFilter.address });
      isLogFactoryMatched({ factory: logFilter.address, log: sampleLog });
    }
    isAddressMatched({
      address: sampleLog.address,
      blockNumber: 0,
      childAddresses: new Map<Address, number>(),
    });
    isLogFilterMatched({ filter: logFilter, log: sampleLog });
    isBlockFilterMatched({ filter: blockFilter, block: sampleBlock });
    isTransactionFilterMatched({
      filter: transactionFilter,
      transaction: sampleTransaction,
    });
    isTraceFilterMatched({
      filter: traceFilter,
      trace: sampleTrace,
      block: sampleBlock,
    });
    isTransferFilterMatched({
      filter: transferFilter,
      trace: sampleTrace,
      block: sampleBlock,
    });

    return undefined as SyncBlock | undefined;
  },
});

test("chain.sync.historical accepts a provider implemented from ponder/sync", () => {
  createConfig({
    chains: {
      mainnet: { id: 1, rpc: http(), sync: { historical: provider } },
    },
    contracts: {},
  });
});

test("chain.sync.historical accepts a full-filter (log/block/transaction/trace/transfer) provider", () => {
  createConfig({
    chains: {
      mainnet: { id: 1, rpc: http(), sync: { historical: fullFilterProvider } },
    },
    contracts: {},
  });
});

test("chain.sync without a provider is still valid", () => {
  createConfig({
    chains: { mainnet: { id: 1, rpc: http() } },
    contracts: {},
  });
});

test("chain.sync.historical rejects a wrong-shaped factory", () => {
  createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: http(),
        // @ts-expect-error — must return a HistoricalSync (syncBlockRangeData / syncBlockData)
        sync: { historical: () => ({ nope: true }) },
      },
    },
    contracts: {},
  });
});
