import { checksumAddress, getEventSelector, http } from "viem";
import { beforeEach, expect, test, vi } from "vitest";

import { usdcContractConfig } from "@/_test/constants.js";
import { setupIndexingStore, setupSyncStore } from "@/_test/setup.js";
import type { IndexingFunctions } from "@/build/functions.js";
import type { Source } from "@/config/sources.js";
import { createSchema } from "@/schema/schema.js";
import type { SyncGateway } from "@/sync-gateway/service.js";

import { IndexingService } from "./service.js";

beforeEach((context) => setupIndexingStore(context));
beforeEach((context) => setupSyncStore(context));

const networks = {
  mainnet: {
    chainId: 1,
    transport: http(),
  },
};

const sources: Source[] = [
  {
    ...usdcContractConfig,
    id: `USDC_mainnet`,
    contractName: "USDC",
    networkName: "mainnet",
    criteria: { address: usdcContractConfig.address },
    startBlock: 16369950,
    type: "logFilter",
  },
];

const schema = createSchema((p) => ({
  TransferEvent: p.createTable({
    id: p.string(),
    timestamp: p.int(),
  }),
}));

const transferIndexingFunction = vi.fn(async ({ event, context }) => {
  await context.db.TransferEvent.create({
    id: event.log.id,
    data: {
      timestamp: Number(event.block.timestamp),
    },
  });
});

const transferSelector = getEventSelector(usdcContractConfig.abi[1]);

const indexingFunctions: IndexingFunctions = {
  _meta_: {},
  USDC: { Transfer: transferIndexingFunction },
};

const transferLog = {
  topics: [
    transferSelector,
    "0x00000000000000000000000021b5f64fa05c64f84302e8a73198b643774e8e49",
    "0x000000000000000000000000c908b3848960114091a1bcf9d649e27b25385642",
  ],
  data: "0x0000000000000000000000000000000000000000000000000007e9657c20364d",
};

const getEvents = vi.fn(async function* getEvents({
  // fromTimestamp,
  toTimestamp,
}) {
  yield {
    events: [
      {
        sourceId: "USDC_mainnet",
        chainId: 1,
        log: { id: String(toTimestamp), ...transferLog },
        block: { timestamp: BigInt(toTimestamp) },
        transaction: {},
      },
    ],
    metadata: {
      pageEndsAtTimestamp: toTimestamp,
      counts: [
        {
          sourceId: "USDC_mainnet",
          selector: transferSelector,
          count: 5,
        },
      ],
    },
  };
});

const syncGatewayService = {
  getEvents,
  checkpoint: 0,
} as unknown as SyncGateway;

beforeEach(() => {
  // Restore getEvents to the initial implementation.
  vi.restoreAllMocks();
  syncGatewayService.checkpoint = 0;
});

test("processEvents() calls getEvents with sequential timestamp ranges", async (context) => {
  const { common, syncStore, indexingStore } = context;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
  });

  await service.reset({ schema, indexingFunctions });

  expect(getEvents).not.toHaveBeenCalled();

  syncGatewayService.checkpoint = 10;
  await service.processEvents();

  expect(getEvents).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fromTimestamp: 0,
      toTimestamp: 10,
    }),
  );

  syncGatewayService.checkpoint = 50;
  await service.processEvents();

  expect(getEvents).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fromTimestamp: 11,
      toTimestamp: 50,
    }),
  );

  await service.kill();
});

test("processEvents() calls indexing functions with correct arguments", async (context) => {
  const { common, syncStore, indexingStore } = context;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
  });

  await service.reset({ schema, indexingFunctions });

  syncGatewayService.checkpoint = 10;
  await service.processEvents();

  expect(transferIndexingFunction).toHaveBeenCalledWith(
    expect.objectContaining({
      event: {
        name: "Transfer",
        args: {
          from: checksumAddress("0x21b5f64fa05c64f84302e8a73198b643774e8e49"),
          to: checksumAddress("0xc908b3848960114091a1bcf9d649e27b25385642"),
          value: 2226946920429133n,
        },
        log: { id: "10", ...transferLog },
        block: { timestamp: 10n },
        transaction: {},
      },
      context: expect.objectContaining({
        db: { TransferEvent: expect.anything() },
        network: { name: "mainnet", chainId: 1 },
        client: expect.anything(),
        contracts: { USDC: expect.anything() },
      }),
    }),
  );

  await service.kill();
});

test("processEvents() model methods insert data into the indexing store", async (context) => {
  const { common, syncStore, indexingStore } = context;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
  });

  await service.reset({ schema, indexingFunctions });

  syncGatewayService.checkpoint = 10;
  await service.processEvents();

  const transferEvents = await indexingStore.findMany({
    tableName: "TransferEvent",
  });
  expect(transferEvents.length).toBe(1);

  await service.kill();
});

test("processEvents() updates event count metrics", async (context) => {
  const { common, syncStore, indexingStore } = context;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
  });

  await service.reset({ schema, indexingFunctions });

  syncGatewayService.checkpoint = 10;
  await service.processEvents();

  const matchedEventsMetric = (
    await common.metrics.ponder_indexing_matched_events.get()
  ).values;
  expect(matchedEventsMetric).toMatchObject([
    {
      labels: { network: "mainnet", contract: "USDC", event: "Transfer" },
      value: 5,
    },
  ]);

  const handledEventsMetric = (
    await common.metrics.ponder_indexing_handled_events.get()
  ).values;
  expect(handledEventsMetric).toMatchObject([
    {
      labels: { network: "mainnet", contract: "USDC", event: "Transfer" },
      value: 5,
    },
  ]);

  const processedEventsMetric = (
    await common.metrics.ponder_indexing_processed_events.get()
  ).values;
  expect(processedEventsMetric).toMatchObject([
    {
      labels: { network: "mainnet", contract: "USDC", event: "Transfer" },
      value: 1,
    },
  ]);

  await service.kill();
});

test("reset() reloads the indexing store", async (context) => {
  const { common, syncStore, indexingStore } = context;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
  });

  await service.reset({ schema, indexingFunctions });

  syncGatewayService.checkpoint = 10;
  await service.processEvents();

  const transferEvents = await indexingStore.findMany({
    tableName: "TransferEvent",
  });
  expect(transferEvents.length).toBe(1);

  await service.reset({ schema, indexingFunctions });

  const transferEventsAfterReset = await indexingStore.findMany({
    tableName: "TransferEvent",
  });
  expect(transferEventsAfterReset.length).toBe(0);

  await service.kill();
});

test("handleReorg() updates ponder_handlers_latest_processed_timestamp metric", async (context) => {
  const { common, syncStore, indexingStore } = context;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
  });

  await service.reset({ schema, indexingFunctions });

  syncGatewayService.checkpoint = 10;
  await service.processEvents();

  const latestProcessedTimestampMetric = (
    await common.metrics.ponder_indexing_latest_processed_timestamp.get()
  ).values[0].value;
  expect(latestProcessedTimestampMetric).toBe(10);

  await service.reset({ schema, indexingFunctions });

  const latestProcessedTimestampMetricAfterReset = (
    await common.metrics.ponder_indexing_latest_processed_timestamp.get()
  ).values[0].value;
  expect(latestProcessedTimestampMetricAfterReset).toBe(0);

  await service.kill();
});

test("handleReorg() reverts the indexing store", async (context) => {
  const { common, syncStore, indexingStore } = context;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
  });

  const indexingStoreRevertSpy = vi.spyOn(indexingStore, "revert");

  await service.reset({ schema, indexingFunctions });

  syncGatewayService.checkpoint = 10;
  await service.processEvents();

  await service.handleReorg({ commonAncestorTimestamp: 6 });

  expect(indexingStoreRevertSpy).toHaveBeenLastCalledWith({ safeTimestamp: 6 });

  await service.kill();
});

test("handleReorg() does nothing if there is a user error", async (context) => {
  const { common, syncStore, indexingStore } = context;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
  });

  const indexingStoreRevertSpy = vi.spyOn(indexingStore, "revert");

  await service.reset({ schema, indexingFunctions });

  transferIndexingFunction.mockImplementationOnce(() => {
    throw new Error("User error!");
  });

  syncGatewayService.checkpoint = 10;
  await service.processEvents();

  await service.handleReorg({ commonAncestorTimestamp: 6 });

  expect(indexingStoreRevertSpy).not.toHaveBeenCalled();

  await service.kill();
});

test("handleReorg() processes the correct range of events after a reorg", async (context) => {
  const { common, syncStore, indexingStore } = context;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
  });

  await service.reset({ schema, indexingFunctions });

  syncGatewayService.checkpoint = 10;
  await service.processEvents();

  expect(getEvents).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fromTimestamp: 0,
      toTimestamp: 10,
    }),
  );

  // This simulates a scenario where there was a reorg back to 6
  // and the new latest block is 9.
  syncGatewayService.checkpoint = 9;
  await service.handleReorg({ commonAncestorTimestamp: 6 });
  await service.processEvents();

  expect(getEvents).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fromTimestamp: 7,
      toTimestamp: 9,
    }),
  );

  await service.kill();
});

test("handleReorg() updates ponder_handlers_latest_processed_timestamp metric", async (context) => {
  const { common, syncStore, indexingStore } = context;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
  });

  await service.reset({ schema, indexingFunctions });

  syncGatewayService.checkpoint = 10;
  await service.processEvents();

  const latestProcessedTimestampMetric = (
    await common.metrics.ponder_indexing_latest_processed_timestamp.get()
  ).values[0].value;
  expect(latestProcessedTimestampMetric).toBe(10);

  // This simulates a scenario where there was a reorg back to 6
  // and the new latest block is 9.
  syncGatewayService.checkpoint = 9;
  await service.handleReorg({ commonAncestorTimestamp: 6 });

  const latestProcessedTimestampMetricAfterReorg = (
    await common.metrics.ponder_indexing_latest_processed_timestamp.get()
  ).values[0].value;
  expect(latestProcessedTimestampMetricAfterReorg).toBe(6);

  await service.kill();
});
