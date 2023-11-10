import { http } from "viem";
import { beforeEach, expect, test, vi } from "vitest";

import { usdcContractConfig } from "@/_test/constants.js";
import { setupIndexingStore, setupSyncStore } from "@/_test/setup.js";
import type { IndexingFunctions } from "@/build/functions.js";
import type { LogEventMetadata } from "@/config/abi.js";
import type { Source } from "@/config/sources.js";
import * as p from "@/schema/index.js";
import type { SyncGateway } from "@/sync-gateway/service.js";

import { IndexingService } from "./service.js";

beforeEach((context) => setupIndexingStore(context));
beforeEach((context) => setupSyncStore(context));

const networks = [
  {
    name: "mainnet",
    chainId: 1,
    transport: http(),
  },
];

const sources: Source[] = [
  {
    name: "USDC",
    ...usdcContractConfig,
    network: "mainnet",
    criteria: { address: usdcContractConfig.address },
    startBlock: 16369950,
    type: "logFilter",
  },
];

const schema = p.createSchema({
  TransferEvent: p.createTable({
    id: p.string(),
    timestamp: p.int(),
  }),
});

const transferIndexingFunction = vi.fn(async ({ event, context }) => {
  await context.models.TransferEvent.create({
    id: event.log.id,
    data: {
      timestamp: Number(event.block.timestamp),
    },
  });
});

const transferEventMetadata = usdcContractConfig.events[
  "Transfer"
] as LogEventMetadata;

const indexingFunctions: IndexingFunctions = {
  _meta_: {},
  eventSources: {
    USDC: {
      bySelector: {
        [transferEventMetadata.selector]: transferEventMetadata,
      },
      bySafeName: {
        ["Transfer"]: {
          ...transferEventMetadata,
          fn: transferIndexingFunction,
        },
      },
    },
  },
};

const getEvents = vi.fn(async function* getEvents({
  // fromTimestamp,
  toTimestamp,
}) {
  yield {
    events: [
      {
        eventSourceName: "USDC",
        eventName: "Transfer",
        params: { from: "0x0", to: "0x1", amount: 100n },
        log: { id: String(toTimestamp) },
        block: { timestamp: BigInt(toTimestamp) },
        transaction: {},
      },
    ],
    metadata: {
      pageEndsAtTimestamp: toTimestamp,
      counts: [
        {
          eventSourceName: "USDC",
          selector: transferEventMetadata.selector,
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

  service.kill();
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
        eventSourceName: "USDC",
        eventName: "Transfer",
        params: { from: "0x0", to: "0x1", amount: 100n },
        log: { id: "10" },
        block: { timestamp: 10n },
        transaction: {},
        name: "Transfer",
      },
      context: expect.objectContaining({
        models: { TransferEvent: expect.anything() },
      }),
    }),
  );

  service.kill();
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
    modelName: "TransferEvent",
  });
  expect(transferEvents.length).toBe(1);

  service.kill();
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
    { labels: { eventName: "setup" }, value: 1 },
    { labels: { eventName: "USDC:Transfer" }, value: 5 },
  ]);

  const handledEventsMetric = (
    await common.metrics.ponder_indexing_handled_events.get()
  ).values;
  expect(handledEventsMetric).toMatchObject([
    { labels: { eventName: "USDC:Transfer" }, value: 5 },
  ]);

  const processedEventsMetric = (
    await common.metrics.ponder_indexing_processed_events.get()
  ).values;
  expect(processedEventsMetric).toMatchObject([
    { labels: { eventName: "USDC:Transfer" }, value: 1 },
  ]);

  service.kill();
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
    modelName: "TransferEvent",
  });
  expect(transferEvents.length).toBe(1);

  const versionIdBeforeReset = indexingStore.versionId;

  await service.reset({ schema, indexingFunctions });

  expect(indexingStore.versionId).not.toBe(versionIdBeforeReset);

  const transferEventsAfterReset = await indexingStore.findMany({
    modelName: "TransferEvent",
  });
  expect(transferEventsAfterReset.length).toBe(0);

  service.kill();
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

  service.kill();
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

  service.kill();
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

  service.kill();
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

  service.kill();
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

  service.kill();
});
