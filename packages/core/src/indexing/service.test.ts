import { erc20ABI } from "@/_test/generated.js";
import {
  setupAnvil,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getEventsErc20 } from "@/_test/utils.js";
import type { IndexingFunctions } from "@/build/functions/functions.js";
import type { TableAccess } from "@/build/static/getTableAccess.js";
import { createSchema } from "@/schema/schema.js";
import { SyncService } from "@/sync/service.js";
import { type Checkpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { decodeEventLog } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import { IndexingService } from "./service.js";

beforeEach((context) => setupAnvil(context));
beforeEach((context) => setupIsolatedDatabase(context));

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
  Erc20: { Transfer: transferIndexingFunction },
};

const readContractIndexingFunctions: IndexingFunctions = {
  Erc20: { Transfer: readContractTransferIndexingFunction },
};

const tableAccess: TableAccess = {
  "Erc20:Transfer": {
    access: [
      {
        storeMethod: "create",
        tableName: "TransferEvent",
      },
    ],
    hash: "hash",
  },
};

function createCheckpoint(index: number): Checkpoint {
  return { ...zeroCheckpoint, blockTimestamp: index, blockNumber: index };
}

test("processEvents() calls getEvents with sequential timestamp ranges", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const getEventsSpy = vi.spyOn(syncService, "getEvents");

  const service = new IndexingService({
    common,
    syncService,
    indexingStore,
    sources,
    networks,
  });
  await service.start({
    schema,
    indexingFunctions,
    tableAccess,
    cachedToCheckpoint: zeroCheckpoint,
  });

  expect(getEventsSpy).not.toHaveBeenCalled();

  const checkpoint10 = createCheckpoint(10);
  syncService.checkpoint = checkpoint10;
  await service.processEvents();

  expect(getEventsSpy).toHaveBeenCalledOnce();

  expect(getEventsSpy).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fromCheckpoint: zeroCheckpoint,
      toCheckpoint: checkpoint10,
    }),
  );

  const checkpoint50 = createCheckpoint(50);
  syncService.checkpoint = checkpoint50;
  await service.processEvents();

  expect(getEventsSpy).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fromCheckpoint: checkpoint10,
      toCheckpoint: checkpoint50,
    }),
  );

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("processEvents() calls indexing functions with correct arguments", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const getEventsSpy = vi.spyOn(syncService, "getEvents");

  const service = new IndexingService({
    common,
    syncService,
    indexingStore,
    sources,
    networks,
  });
  await service.start({
    schema,
    indexingFunctions,
    tableAccess,
    cachedToCheckpoint: zeroCheckpoint,
  });

  const checkpoint10 = createCheckpoint(10);
  syncService.checkpoint = checkpoint10;

  const events = await getEventsErc20(sources, checkpoint10);
  getEventsSpy.mockReturnValue(Promise.resolve(events));

  await service.processEvents();

  expect(transferIndexingFunction).toHaveBeenCalledWith(
    expect.objectContaining({
      event: {
        name: "Transfer",
        args: decodeEventLog({
          abi: erc20ABI,
          data: events.events[1]!.log.data,
          topics: events.events[1]!.log.topics,
        }).args,
        log: events.events[1].log,
        block: events.events[1].block,
        transaction: events.events[1].transaction,
      },
      context: expect.objectContaining({
        db: { TransferEvent: expect.anything(), Supply: expect.anything() },
        network: { name: "mainnet", chainId: 1 },
        client: expect.anything(),
        contracts: { Erc20: expect.anything(), Pair: expect.anything() },
      }),
    }),
  );

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("processEvent() runs setup functions before log event", async (context) => {
  let setup = false;

  const setupIndexingFunction = vi.fn(async () => {
    setup = true;
  });

  const transferIndexingFunction = vi.fn(async () => {
    expect(setup).toBe(true);
  });

  const indexingFunctions = {
    Erc20: {
      Transfer: transferIndexingFunction,
      setup: setupIndexingFunction,
    },
  };

  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const syncService = new SyncService({ common, syncStore, networks, sources });

  const getEventsSpy = vi.spyOn(syncService, "getEvents");

  const service = new IndexingService({
    common,
    syncService,
    indexingStore,
    sources,
    networks,
  });

  await service.start({
    schema,
    indexingFunctions,
    tableAccess,
    cachedToCheckpoint: zeroCheckpoint,
  });

  service.queue!.concurrency = 1;

  const checkpoint10 = createCheckpoint(10);
  syncService.checkpoint = checkpoint10;

  const events = await getEventsErc20(sources, checkpoint10);
  getEventsSpy.mockReturnValue(Promise.resolve(events));

  await service.processEvents();

  expect(setupIndexingFunction).toHaveBeenCalledTimes(1);
  expect(transferIndexingFunction).toHaveBeenCalledTimes(2);

  expect(setup).toBe(true);

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("processEvents() orders tasks with no parents or self reliance", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const getEventsSpy = vi.spyOn(syncService, "getEvents");

  const service = new IndexingService({
    common,
    syncService,
    indexingStore,
    sources,
    networks,
  });

  await service.start({
    schema,
    indexingFunctions,
    tableAccess,
    cachedToCheckpoint: zeroCheckpoint,
  });

  const checkpoint10 = createCheckpoint(10);
  syncService.checkpoint = checkpoint10;

  const events = await getEventsErc20(sources, checkpoint10);
  getEventsSpy.mockReturnValue(Promise.resolve(events));

  await service.loadIndexingFunctionTasks("Erc20:Transfer");

  service.enqueueLogEventTasks();

  expect(service.queue?.size).toBe(2);

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("processEvents() orders tasks with self reliance", async (context) => {
  const { common, sources, networks } = context;

  const tableAccess: TableAccess = {
    "Erc20:Transfer": {
      access: [
        {
          tableName: "TransferEvent",
          storeMethod: "update",
        },
      ],
      hash: "hash",
    },
  };

  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const getEventsSpy = vi.spyOn(syncService, "getEvents");

  const service = new IndexingService({
    common,
    syncService,
    indexingStore,
    sources,
    networks,
  });

  await service.start({
    schema,
    indexingFunctions,
    tableAccess,
    cachedToCheckpoint: zeroCheckpoint,
  });

  const checkpoint10 = createCheckpoint(10);
  syncService.checkpoint = checkpoint10;

  const events = await getEventsErc20(sources, checkpoint10);
  getEventsSpy.mockReturnValue(Promise.resolve(events));

  await service.loadIndexingFunctionTasks("Erc20:Transfer");

  service.enqueueLogEventTasks();

  expect(service.queue?.size).toBe(1);

  service.processEvents();

  await service.onIdle();

  expect(transferIndexingFunction).toHaveBeenCalledTimes(2);

  await service.kill();
  await service.onIdle();

  await cleanup();
});

test("processEvents() model methods insert data into the indexing store", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const getEventsSpy = vi.spyOn(syncService, "getEvents");

  const service = new IndexingService({
    common,
    syncService,
    indexingStore,
    sources,
    networks,
  });

  await service.start({
    schema,
    indexingFunctions,
    tableAccess,
    cachedToCheckpoint: zeroCheckpoint,
  });

  const checkpoint10 = createCheckpoint(10);
  syncService.checkpoint = checkpoint10;

  const events = await getEventsErc20(sources, checkpoint10);
  getEventsSpy.mockReturnValue(Promise.resolve(events));
  await service.processEvents();

  const { items: transferEvents } = await indexingStore.findMany({
    tableName: "TransferEvent",
  });
  expect(transferEvents.length).toBe(2);

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("processEvents() updates metrics", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const getEventsSpy = vi.spyOn(syncService, "getEvents");

  const service = new IndexingService({
    common,
    syncService,
    indexingStore,
    sources,
    networks,
  });

  await service.start({
    schema,
    indexingFunctions,
    tableAccess,
    cachedToCheckpoint: zeroCheckpoint,
  });

  const checkpoint10 = createCheckpoint(10);
  syncService.checkpoint = checkpoint10;

  const events = await getEventsErc20(sources, checkpoint10);
  getEventsSpy.mockReturnValue(Promise.resolve(events));
  await service.processEvents();

  const totalSecondsMetric = (
    await common.metrics.ponder_indexing_total_seconds.get()
  ).values;
  expect(totalSecondsMetric).toHaveLength(1);

  const completedSecondsMetric = (
    await common.metrics.ponder_indexing_completed_seconds.get()
  ).values;
  expect(completedSecondsMetric).toHaveLength(1);

  const completedEventsMetric = (
    await common.metrics.ponder_indexing_completed_events.get()
  ).values;
  expect(completedEventsMetric).toHaveLength(1);

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("processEvents() reads data from a contract", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const getEventsSpy = vi.spyOn(syncService, "getEvents");

  const service = new IndexingService({
    common,
    syncService,
    indexingStore,
    sources,
    networks,
  });

  await service.start({
    schema,
    indexingFunctions: readContractIndexingFunctions,
    tableAccess,
    cachedToCheckpoint: zeroCheckpoint,
  });

  const checkpoint10 = createCheckpoint(10);
  syncService.checkpoint = checkpoint10;

  const events = await getEventsErc20(sources, checkpoint10);
  getEventsSpy.mockReturnValue(Promise.resolve(events));
  await service.processEvents();

  const { items: supplyEvents } = await indexingStore.findMany({
    tableName: "Supply",
  });
  expect(supplyEvents.length).toBe(2);

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("processEvents() recovers from errors while reading data from a contract", async (context) => {
  const { common, sources, networks, requestQueues } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const getEventsSpy = vi.spyOn(syncService, "getEvents");

  const service = new IndexingService({
    common,
    syncService,
    indexingStore,
    sources,
    networks,
  });

  const spy = vi.spyOn(requestQueues[0], "request");
  spy.mockRejectedValueOnce(new Error("Unexpected error!"));

  await service.start({
    schema,
    indexingFunctions: readContractIndexingFunctions,
    tableAccess,
    cachedToCheckpoint: zeroCheckpoint,
  });

  const checkpoint10 = createCheckpoint(10);
  syncService.checkpoint = checkpoint10;

  const events = await getEventsErc20(sources, checkpoint10);
  getEventsSpy.mockReturnValue(Promise.resolve(events));
  await service.processEvents();

  const { items: supplyEvents } = await indexingStore.findMany({
    tableName: "Supply",
  });
  expect(supplyEvents.length).toBe(2);

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("processEvents() retries indexing functions", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const getEventsSpy = vi.spyOn(syncService, "getEvents");

  const service = new IndexingService({
    common,
    syncService,
    indexingStore,
    sources,
    networks,
  });

  const indexingStoreRevertSpy = vi.spyOn(indexingStore, "revert");

  await service.start({
    schema,
    indexingFunctions,
    tableAccess,
    cachedToCheckpoint: zeroCheckpoint,
  });

  transferIndexingFunction.mockImplementationOnce(() => {
    throw new Error("User error!");
  });

  const checkpoint10 = createCheckpoint(10);
  syncService.checkpoint = checkpoint10;

  const events = await getEventsErc20(sources, checkpoint10);
  getEventsSpy.mockReturnValue(Promise.resolve(events));
  await service.processEvents();

  expect(transferIndexingFunction).toHaveBeenCalledTimes(3);
  expect(indexingStoreRevertSpy).toHaveBeenCalledOnce();

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("processEvents() handles errors", async (context) => {
  const { common, sources, networks } = context;

  const tableAccess: TableAccess = {
    "Erc20:Transfer": {
      access: [
        {
          tableName: "TransferEvent",
          storeMethod: "update",
        },
      ],
      hash: "hash",
    },
  };

  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const getEventsSpy = vi.spyOn(syncService, "getEvents");

  const service = new IndexingService({
    common,
    syncService,
    indexingStore,
    sources,
    networks,
  });

  const indexingStoreRevertSpy = vi.spyOn(indexingStore, "revert");

  await service.start({
    schema,
    indexingFunctions,
    tableAccess,
    cachedToCheckpoint: zeroCheckpoint,
  });

  transferIndexingFunction.mockImplementation(() => {
    throw new Error("User error!");
  });

  const checkpoint10 = createCheckpoint(10);
  syncService.checkpoint = checkpoint10;

  const events = await getEventsErc20(sources, checkpoint10);
  getEventsSpy.mockReturnValue(Promise.resolve(events));
  await service.processEvents();

  expect(transferIndexingFunction).toHaveBeenCalledTimes(4);
  expect(indexingStoreRevertSpy).toHaveBeenCalledTimes(3);

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("processEvents can be called multiple times", async (context) => {
  const { common, sources, networks } = context;

  const setupIndexingFunction = vi.fn(async () => {});
  const indexingFunctions = {
    Erc20: {
      Transfer: transferIndexingFunction,
      setup: setupIndexingFunction,
    },
  };

  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const getEventsSpy = vi.spyOn(syncService, "getEvents");

  const service = new IndexingService({
    common,
    syncService,
    indexingStore,
    sources,
    networks,
  });

  await service.start({
    schema,
    indexingFunctions,
    tableAccess,
    cachedToCheckpoint: zeroCheckpoint,
  });

  const checkpoint10 = createCheckpoint(10);
  syncService.checkpoint = checkpoint10;

  const events = await getEventsErc20(sources, checkpoint10);
  getEventsSpy.mockReturnValue(Promise.resolve(events));

  await service.processEvents();
  await service.processEvents();

  expect(setupIndexingFunction).toHaveBeenCalledTimes(1);
  expect(transferIndexingFunction).toHaveBeenCalledTimes(2);

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("handleReorg() updates ponder_indexing_completed_timestamp metric", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const getEventsSpy = vi.spyOn(syncService, "getEvents");

  const service = new IndexingService({
    common,
    syncService,
    indexingStore,
    sources,
    networks,
  });

  await service.start({
    schema,
    indexingFunctions,
    tableAccess,
    cachedToCheckpoint: zeroCheckpoint,
  });

  const checkpoint10 = createCheckpoint(10);
  syncService.checkpoint = checkpoint10;

  const events = await getEventsErc20(sources, checkpoint10);
  getEventsSpy.mockReturnValue(Promise.resolve(events));

  await service.processEvents();

  const checkpoint6 = createCheckpoint(6);
  await service.handleReorg(checkpoint6);

  const latestProcessedTimestampMetricAfterReset = (
    await common.metrics.ponder_indexing_completed_timestamp.get()
  ).values[0].value;
  expect(latestProcessedTimestampMetricAfterReset).toBe(6);

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("handleReorg() reverts the indexing store", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const getEventsSpy = vi.spyOn(syncService, "getEvents");

  const service = new IndexingService({
    common,
    syncService,
    indexingStore,
    sources,
    networks,
  });

  const indexingStoreRevertSpy = vi.spyOn(indexingStore, "revert");

  await service.start({
    schema,
    indexingFunctions,
    tableAccess,
    cachedToCheckpoint: zeroCheckpoint,
  });

  const checkpoint10 = createCheckpoint(10);
  syncService.checkpoint = checkpoint10;

  const events = await getEventsErc20(sources, checkpoint10);
  getEventsSpy.mockReturnValue(Promise.resolve(events));

  await service.processEvents();

  const checkpoint6 = createCheckpoint(6);
  await service.handleReorg(checkpoint6);

  expect(indexingStoreRevertSpy).toHaveBeenLastCalledWith({
    checkpoint: checkpoint6,
  });

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("handleReorg() does nothing if there is a user error", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const getEventsSpy = vi.spyOn(syncService, "getEvents");

  const service = new IndexingService({
    common,
    syncService,
    indexingStore,
    sources,
    networks,
  });

  const indexingStoreRevertSpy = vi.spyOn(indexingStore, "revert");

  await service.start({
    schema,
    indexingFunctions,
    tableAccess,
    cachedToCheckpoint: zeroCheckpoint,
  });

  transferIndexingFunction.mockImplementation(() => {
    throw new Error("User error!");
  });

  const checkpoint10 = createCheckpoint(10);
  syncService.checkpoint = checkpoint10;

  const events = await getEventsErc20(sources, checkpoint10);
  getEventsSpy.mockReturnValue(Promise.resolve(events));

  await service.processEvents();

  const checkpoint6 = createCheckpoint(6);
  await service.handleReorg(checkpoint6);

  expect(indexingStoreRevertSpy).not.toHaveBeenCalledWith({
    checkpoint: checkpoint6,
  });

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("handleReorg() processes the correct range of events after a reorg", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const getEventsSpy = vi.spyOn(syncService, "getEvents");

  const service = new IndexingService({
    common,
    syncService,
    indexingStore,
    sources,
    networks,
  });

  await service.start({
    schema,
    indexingFunctions,
    tableAccess,
    cachedToCheckpoint: zeroCheckpoint,
  });

  const checkpoint10 = createCheckpoint(10);
  syncService.checkpoint = checkpoint10;

  const events = await getEventsErc20(sources, checkpoint10);
  getEventsSpy.mockReturnValue(Promise.resolve(events));

  await service.processEvents();

  expect(getEventsSpy).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fromCheckpoint: zeroCheckpoint,
      toCheckpoint: checkpoint10,
    }),
  );

  // This simulates a scenario where there was a reorg back to 6
  // and the new latest block is 9.
  const checkpoint9 = createCheckpoint(9);
  syncService.checkpoint = checkpoint9;

  const checkpoint6 = createCheckpoint(6);
  await service.handleReorg(checkpoint6);
  await service.processEvents();

  expect(getEventsSpy).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fromCheckpoint: checkpoint6,
      toCheckpoint: checkpoint9,
    }),
  );

  await service.kill();
  await service.onIdle();
  await cleanup();
});
