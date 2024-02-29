import { erc20ABI } from "@/_test/generated.js";
import {
  setupAnvil,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getEventsErc20, getFunctionIds, getTableIds } from "@/_test/utils.js";
import type { IndexingFunctions } from "@/build/functions/functions.js";
import type { TableAccess } from "@/build/static/parseAst.js";
import { createSchema } from "@/schema/schema.js";
import type { SyncGateway } from "@/sync-gateway/service.js";
import {
  type Checkpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
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

const tableAccess: TableAccess = [
  {
    table: "TransferEvent",
    access: "write",
    indexingFunctionKey: "Erc20:Transfer",
    hash: "",
  },
];

function createCheckpoint(index: number): Checkpoint {
  return { ...zeroCheckpoint, blockTimestamp: index, blockNumber: index };
}

test("processEvents() calls getEvents with sequential timestamp ranges", async (context) => {
  const { common, sources, networks, requestQueues } = context;
  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });
  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

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
  await service.onIdle();
  await cleanup();
});

test("processEvents() calls indexing functions with correct arguments", async (context) => {
  const { common, sources, networks, requestQueues } = context;
  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });
  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  const { events } = getEvents({ toCheckpoint: checkpoint10 });

  expect(transferIndexingFunction).toHaveBeenCalledWith(
    expect.objectContaining({
      event: {
        name: "Transfer",
        args: decodeEventLog({
          abi: erc20ABI,
          data: events[1]!.log.data,
          topics: events[1]!.log.topics,
        }).args,
        log: events[1].log,
        block: events[1].block,
        transaction: events[1].transaction,
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

  const { common, sources, networks, requestQueues } = context;
  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });

  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

  service.queue!.concurrency = 1;

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;

  await service.processEvents();

  expect(setupIndexingFunction).toHaveBeenCalledTimes(1);
  expect(transferIndexingFunction).toHaveBeenCalledTimes(2);

  expect(setup).toBe(true);

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("processEvents() orders tasks with no parents or self reliance", async (context) => {
  const { common, sources, networks, requestQueues } = context;
  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });

  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;

  await service.loadIndexingFunctionTasks("Erc20:Transfer");

  service.enqueueLogEventTasks();

  expect(service.queue?.size).toBe(2);

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("processEvents() orders tasks with self reliance", async (context) => {
  const { common, sources, networks, requestQueues } = context;

  const tableAccess: TableAccess = [
    {
      table: "TransferEvent",
      access: "write",
      indexingFunctionKey: "Erc20:Transfer",
      hash: "",
    },
    {
      table: "TransferEvent",
      access: "read",
      indexingFunctionKey: "Erc20:Transfer",
      hash: "",
    },
  ];

  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });

  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;

  await service.loadIndexingFunctionTasks("Erc20:Transfer");

  service.enqueueLogEventTasks();

  expect(service.queue?.size).toBe(1);

  await service.kill();
  await service.onIdle();

  await cleanup();
});

test("processEvents() model methods insert data into the indexing store", async (context) => {
  const { common, sources, networks, requestQueues } = context;
  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });

  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
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
  const { common, sources, networks, requestQueues } = context;
  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });

  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
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
  const { common, sources, networks, requestQueues } = context;
  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });

  await service.reset({
    schema,
    indexingFunctions: readContractIndexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(readContractIndexingFunctions),
    tableIds: getTableIds(schema),
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
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
  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });

  const spy = vi.spyOn(requestQueues[0], "request");
  spy.mockRejectedValueOnce(new Error("Unexpected error!"));

  await service.reset({
    schema,
    indexingFunctions: readContractIndexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(readContractIndexingFunctions),
    tableIds: getTableIds(schema),
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
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
  const { common, sources, networks, requestQueues } = context;
  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });

  const indexingStoreRevertSpy = vi.spyOn(indexingStore, "revert");

  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

  transferIndexingFunction.mockImplementationOnce(() => {
    throw new Error("User error!");
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  expect(transferIndexingFunction).toHaveBeenCalledTimes(3);
  expect(indexingStoreRevertSpy).toHaveBeenCalledOnce();

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("processEvents() handles errors", async (context) => {
  const { common, sources, networks, requestQueues } = context;

  const tableAccess: TableAccess = [
    {
      table: "TransferEvent",
      access: "write",
      indexingFunctionKey: "Erc20:Transfer",
      hash: "",
    },
    {
      table: "TransferEvent",
      access: "read",
      indexingFunctionKey: "Erc20:Transfer",
      hash: "",
    },
  ];

  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });

  const indexingStoreRevertSpy = vi.spyOn(indexingStore, "revert");

  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

  transferIndexingFunction.mockImplementation(() => {
    throw new Error("User error!");
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  expect(transferIndexingFunction).toHaveBeenCalledTimes(4);
  expect(indexingStoreRevertSpy).toHaveBeenCalledTimes(3);

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("processEvents can be called multiple times", async (context) => {
  const { common, sources, networks, requestQueues } = context;

  const setupIndexingFunction = vi.fn(async () => {});
  const indexingFunctions = {
    Erc20: {
      Transfer: transferIndexingFunction,
      setup: setupIndexingFunction,
    },
  };

  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });

  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;

  await service.processEvents();
  await service.processEvents();

  expect(setupIndexingFunction).toHaveBeenCalledTimes(1);
  expect(transferIndexingFunction).toHaveBeenCalledTimes(2);

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("handleReorg() updates ponder_handlers_latest_processed_timestamp metric", async (context) => {
  const { common, sources, networks, requestQueues } = context;
  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });

  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

  const latestProcessedTimestampMetricAfterReset = (
    await common.metrics.ponder_indexing_completed_timestamp.get()
  ).values[0].value;
  expect(latestProcessedTimestampMetricAfterReset).toBe(0);

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("handleReorg() reverts the indexing store", async (context) => {
  const { common, sources, networks, requestQueues } = context;
  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });

  const indexingStoreRevertSpy = vi.spyOn(indexingStore, "revert");

  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
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
  const { common, sources, networks, requestQueues } = context;
  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });

  const indexingStoreRevertSpy = vi.spyOn(indexingStore, "revert");

  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

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
  await service.onIdle();
  await cleanup();
});

test("handleReorg() processes the correct range of events after a reorg", async (context) => {
  const { common, sources, networks, requestQueues } = context;
  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });

  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

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
  await service.onIdle();
  await cleanup();
});

test("handleReorg() updates ponder_handlers_latest_processed_timestamp metric", async (context) => {
  const { common, sources, networks, requestQueues } = context;
  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: zeroCheckpoint,
    finalityCheckpoint: zeroCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });

  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  // This simulates a scenario where there was a reorg back to 6
  // and the new latest block is 9.
  const checkpoint9 = createCheckpoint(9);
  syncGatewayService.checkpoint = checkpoint9;

  const checkpoint6 = createCheckpoint(6);
  await service.handleReorg(checkpoint6);

  const latestProcessedTimestampMetricAfterReorg = (
    await common.metrics.ponder_indexing_completed_timestamp.get()
  ).values[0].value;
  expect(latestProcessedTimestampMetricAfterReorg).toBe(6);

  await service.kill();
  await service.onIdle();
  await cleanup();
});

test("reset() loads from cache", async (context) => {
  const { common, sources, networks, requestQueues } = context;
  const { database, syncStore, indexingStore, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      tableAccess,
      functionIds: getFunctionIds(indexingFunctions),
      tableIds: getTableIds(schema),
    });

  const getEvents = vi.fn(await getEventsErc20(sources));

  const syncGatewayService = {
    getEvents,
    checkpoint: maxCheckpoint,
    finalityCheckpoint: maxCheckpoint,
  } as unknown as SyncGateway;

  const service = new IndexingService({
    common,
    database,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
    requestQueues,
  });

  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

  await service.processEvents();

  await service.kill();
  await service.onIdle();

  await service.reset({
    schema,
    indexingFunctions,
    tableAccess,
    functionIds: getFunctionIds(indexingFunctions),
    tableIds: getTableIds(schema),
  });

  expect(database.metadata).toStrictEqual([
    {
      eventCount: 2,
      functionId: "Erc20:Transfer",
      fromCheckpoint: {
        blockTimestamp: expect.any(Number),
        blockNumber: expect.any(Number),
        chainId: expect.any(Number),
        logIndex: expect.any(Number),
      },
      toCheckpoint: expect.any(Object),
    },
  ]);

  expect(database.metadata[0].fromCheckpoint?.blockTimestamp).toBeGreaterThan(
    0,
  );

  await service.kill();
  await service.onIdle();
  await cleanup();
});
