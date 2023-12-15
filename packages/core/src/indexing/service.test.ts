import { decodeEventLog } from "viem";
import { beforeEach, expect, test, vi } from "vitest";

import { erc20ABI } from "@/_test/generated.js";
import {
  setupEthClientErc20,
  setupIndexingStore,
  setupSyncStore,
} from "@/_test/setup.js";
import { getEventsHelper } from "@/_test/utils.js";
import type { IndexingFunctions } from "@/build/functions.js";
import { createSchema } from "@/schema/schema.js";
import type { SyncGateway } from "@/sync-gateway/service.js";
import { type Checkpoint, zeroCheckpoint } from "@/utils/checkpoint.js";

import { IndexingService } from "./service.js";

beforeEach((context) => setupEthClientErc20(context));
beforeEach((context) => setupIndexingStore(context));
beforeEach((context) => setupSyncStore(context));
beforeEach(() => {
  // Restore getEvents to the initial implementation.
  vi.restoreAllMocks();
});

const schema = createSchema((p) => ({
  TransferEvent: p.createTable({
    id: p.string(),
    timestamp: p.int(),
  }),
  Supply: p.createTable({
    id: p.string(),
    supply: p.bigint(),
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

const readContractTransferIndexingFunction = vi.fn(
  async ({ event, context }) => {
    const totalSupply = await context.client.readContract({
      abi: erc20ABI,
      functionName: "totalSupply",
      address: event.log.address,
    });

    await context.db.Supply.create({
      id: event.log.id,
      data: {
        supply: totalSupply,
      },
    });
  },
);

const indexingFunctions: IndexingFunctions = {
  _meta_: {},
  Erc20: { Transfer: transferIndexingFunction },
};

const readContractIndexingFunctions: IndexingFunctions = {
  _meta_: {},
  Erc20: { Transfer: readContractTransferIndexingFunction },
};

function createCheckpoint(index: number): Checkpoint {
  return { ...zeroCheckpoint, blockTimestamp: index, blockNumber: index };
}

test("processEvents() calls getEvents with sequential timestamp ranges", async (context) => {
  const { common, syncStore, indexingStore, erc20 } = context;

  const getEvents = vi.fn(await getEventsHelper(erc20.sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources: erc20.sources,
    networks: erc20.networks,
  });
  await service.reset({ schema, indexingFunctions });

  expect(getEvents).not.toHaveBeenCalled();

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  expect(getEvents).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fromCheckpoint: zeroCheckpoint,
      toCheckpoint: checkpoint10,
    }),
  );

  const checkpoint50 = createCheckpoint(50);
  syncGatewayService.checkpoint = checkpoint50;
  await service.processEvents();

  expect(getEvents).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fromCheckpoint: checkpoint10,
      toCheckpoint: checkpoint50,
    }),
  );

  await service.kill();
});

test("processEvents() calls indexing functions with correct arguments", async (context) => {
  const { common, syncStore, indexingStore, erc20 } = context;

  const getEvents = vi.fn(await getEventsHelper(erc20.sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources: erc20.sources,
    networks: erc20.networks,
  });

  await service.reset({ schema, indexingFunctions });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  const events = (await getEvents({ toCheckpoint: checkpoint10 }).next()).value!
    .events;

  expect(transferIndexingFunction).toHaveBeenCalledWith(
    expect.objectContaining({
      event: {
        name: "Transfer",
        args: decodeEventLog({
          abi: erc20ABI,
          data: events[2]!.log.data,
          topics: events[2]!.log.topics,
        }).args,
        log: events[2].log,
        block: events[2].block,
        transaction: events[2].transaction,
      },
      context: expect.objectContaining({
        db: { TransferEvent: expect.anything(), Supply: expect.anything() },
        network: { name: "mainnet", chainId: 1 },
        client: expect.anything(),
        contracts: { Erc20: expect.anything() },
      }),
    }),
  );

  await service.kill();
});

test("processEvents() model methods insert data into the indexing store", async (context) => {
  const { common, syncStore, indexingStore, erc20 } = context;

  const getEvents = vi.fn(await getEventsHelper(erc20.sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources: erc20.sources,
    networks: erc20.networks,
  });

  await service.reset({ schema, indexingFunctions });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  const transferEvents = await indexingStore.findMany({
    tableName: "TransferEvent",
  });
  expect(transferEvents.length).toBe(3);

  await service.kill();
});

test("processEvents() updates event count metrics", async (context) => {
  const { common, syncStore, indexingStore, erc20 } = context;

  const getEvents = vi.fn(await getEventsHelper(erc20.sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources: erc20.sources,
    networks: erc20.networks,
  });

  await service.reset({ schema, indexingFunctions });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  const matchedEventsMetric = (
    await common.metrics.ponder_indexing_matched_events.get()
  ).values;
  expect(matchedEventsMetric).toMatchObject([
    {
      labels: { network: "mainnet", contract: "Erc20", event: "Transfer" },
      value: 5,
    },
  ]);

  const handledEventsMetric = (
    await common.metrics.ponder_indexing_handled_events.get()
  ).values;
  expect(handledEventsMetric).toMatchObject([
    {
      labels: { network: "mainnet", contract: "Erc20", event: "Transfer" },
      value: 5,
    },
  ]);

  const processedEventsMetric = (
    await common.metrics.ponder_indexing_processed_events.get()
  ).values;
  expect(processedEventsMetric).toMatchObject([
    {
      labels: { network: "mainnet", contract: "Erc20", event: "Transfer" },
      value: 3,
    },
  ]);

  await service.kill();
});

test("processEvents() client.readContract", async (context) => {
  const { common, syncStore, indexingStore, erc20 } = context;

  const getEvents = vi.fn(await getEventsHelper(erc20.sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources: erc20.sources,
    networks: erc20.networks,
  });

  await service.reset({
    schema,
    indexingFunctions: readContractIndexingFunctions,
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  const supplyEvents = await indexingStore.findMany({
    tableName: "Supply",
  });
  expect(supplyEvents.length).toBe(3);

  await service.kill();
});

test("processEvents() retries indexing functions", async (context) => {
  const { common, syncStore, indexingStore, erc20 } = context;

  const getEvents = vi.fn(await getEventsHelper(erc20.sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources: erc20.sources,
    networks: erc20.networks,
  });

  const indexingStoreRevertSpy = vi.spyOn(indexingStore, "revert");

  await service.reset({ schema, indexingFunctions });

  transferIndexingFunction.mockImplementationOnce(() => {
    throw new Error("User error!");
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  expect(transferIndexingFunction).toHaveBeenCalledTimes(4);
  expect(indexingStoreRevertSpy).toHaveBeenCalledOnce();

  await service.kill();
});

test("processEvents() handles errors", async (context) => {
  const { common, syncStore, indexingStore, erc20 } = context;

  const getEvents = vi.fn(await getEventsHelper(erc20.sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources: erc20.sources,
    networks: erc20.networks,
  });

  const indexingStoreRevertSpy = vi.spyOn(indexingStore, "revert");

  await service.reset({ schema, indexingFunctions });

  transferIndexingFunction.mockImplementation(() => {
    throw new Error("User error!");
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  expect(transferIndexingFunction).toHaveBeenCalledTimes(4);
  expect(indexingStoreRevertSpy).toHaveBeenCalledTimes(3);

  expect(common.errors.hasUserError).toBe(true);

  await service.kill();
});

test("reset() reloads the indexing store", async (context) => {
  const { common, syncStore, indexingStore, erc20 } = context;

  const getEvents = vi.fn(await getEventsHelper(erc20.sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources: erc20.sources,
    networks: erc20.networks,
  });

  await service.reset({ schema, indexingFunctions });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  const transferEvents = await indexingStore.findMany({
    tableName: "TransferEvent",
  });
  expect(transferEvents.length).toBe(3);

  await service.reset({ schema, indexingFunctions });

  const transferEventsAfterReset = await indexingStore.findMany({
    tableName: "TransferEvent",
  });
  expect(transferEventsAfterReset.length).toBe(0);

  await service.kill();
});

test("handleReorg() updates ponder_handlers_latest_processed_timestamp metric", async (context) => {
  const { common, syncStore, indexingStore, erc20 } = context;

  const getEvents = vi.fn(await getEventsHelper(erc20.sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources: erc20.sources,
    networks: erc20.networks,
  });

  await service.reset({ schema, indexingFunctions });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
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
  const { common, syncStore, indexingStore, erc20 } = context;

  const getEvents = vi.fn(await getEventsHelper(erc20.sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources: erc20.sources,
    networks: erc20.networks,
  });

  const indexingStoreRevertSpy = vi.spyOn(indexingStore, "revert");

  await service.reset({ schema, indexingFunctions });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  const checkpoint6 = createCheckpoint(6);
  await service.handleReorg(checkpoint6);

  expect(indexingStoreRevertSpy).toHaveBeenLastCalledWith({
    checkpoint: checkpoint6,
  });

  await service.kill();
});

test("handleReorg() does nothing if there is a user error", async (context) => {
  const { common, syncStore, indexingStore, erc20 } = context;

  const getEvents = vi.fn(await getEventsHelper(erc20.sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources: erc20.sources,
    networks: erc20.networks,
  });

  const indexingStoreRevertSpy = vi.spyOn(indexingStore, "revert");

  await service.reset({ schema, indexingFunctions });

  transferIndexingFunction.mockImplementation(() => {
    throw new Error("User error!");
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  const checkpoint6 = createCheckpoint(6);
  await service.handleReorg(checkpoint6);

  expect(indexingStoreRevertSpy).not.toHaveBeenCalledWith({
    checkpoint: checkpoint6,
  });

  await service.kill();
});

test("handleReorg() processes the correct range of events after a reorg", async (context) => {
  const { common, syncStore, indexingStore, erc20 } = context;

  const getEvents = vi.fn(await getEventsHelper(erc20.sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources: erc20.sources,
    networks: erc20.networks,
  });

  await service.reset({ schema, indexingFunctions });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  expect(getEvents).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fromCheckpoint: zeroCheckpoint,
      toCheckpoint: checkpoint10,
    }),
  );

  // This simulates a scenario where there was a reorg back to 6
  // and the new latest block is 9.
  const checkpoint9 = createCheckpoint(9);
  syncGatewayService.checkpoint = checkpoint9;

  const checkpoint6 = createCheckpoint(6);
  await service.handleReorg(checkpoint6);
  await service.processEvents();

  expect(getEvents).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fromCheckpoint: checkpoint6,
      toCheckpoint: checkpoint9,
    }),
  );

  await service.kill();
});

test("handleReorg() updates ponder_handlers_latest_processed_timestamp metric", async (context) => {
  const { common, syncStore, indexingStore, erc20 } = context;

  const getEvents = vi.fn(await getEventsHelper(erc20.sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources: erc20.sources,
    networks: erc20.networks,
  });

  await service.reset({ schema, indexingFunctions });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  const latestProcessedTimestampMetric = (
    await common.metrics.ponder_indexing_latest_processed_timestamp.get()
  ).values[0].value;
  expect(latestProcessedTimestampMetric).toBe(10);

  // This simulates a scenario where there was a reorg back to 6
  // and the new latest block is 9.
  const checkpoint9 = createCheckpoint(9);
  syncGatewayService.checkpoint = checkpoint9;

  const checkpoint6 = createCheckpoint(6);
  await service.handleReorg(checkpoint6);

  const latestProcessedTimestampMetricAfterReorg = (
    await common.metrics.ponder_indexing_latest_processed_timestamp.get()
  ).values[0].value;
  expect(latestProcessedTimestampMetricAfterReorg).toBe(6);

  await service.kill();
});
