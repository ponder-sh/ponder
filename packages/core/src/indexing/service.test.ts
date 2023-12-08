import { checksumAddress, getEventSelector } from "viem";
import { rpc } from "viem/utils";
import { beforeEach, expect, test, vi } from "vitest";

import { usdcContractConfig } from "@/_test/constants.js";
import { setupIndexingStore, setupSyncStore } from "@/_test/setup.js";
import { anvil } from "@/_test/utils.js";
import type { IndexingFunctions } from "@/build/functions.js";
import type { Network } from "@/config/networks.js";
import type { Source } from "@/config/sources.js";
import { createSchema } from "@/schema/schema.js";
import type { SyncGateway } from "@/sync-gateway/service.js";
import { type Checkpoint, zeroCheckpoint } from "@/utils/checkpoint.js";

import { IndexingService } from "./service.js";

beforeEach((context) => setupIndexingStore(context));
beforeEach((context) => setupSyncStore(context));

const networks: Pick<Network, "url" | "request" | "chainId" | "name">[] = [
  {
    request: (options) => rpc.http(anvil.rpcUrls.default.http[0], options),
    url: anvil.rpcUrls.default.http[0],
    chainId: 1,
    name: "mainnet",
  },
];

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
      abi: usdcContractConfig.abi,
      functionName: "totalSupply",
      address: usdcContractConfig.address,
    });

    await context.db.Supply.create({
      id: event.log.id,
      data: {
        supply: totalSupply,
      },
    });
  },
);

const transferSelector = getEventSelector(usdcContractConfig.abi[1]);

const indexingFunctions: IndexingFunctions = {
  _meta_: {},
  USDC: { Transfer: transferIndexingFunction },
};

const readContractIndexingFunctions: IndexingFunctions = {
  _meta_: {},
  USDC: { Transfer: readContractTransferIndexingFunction },
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
  // fromCheckpoint,
  toCheckpoint,
}) {
  yield {
    events: [
      {
        sourceId: "USDC_mainnet",
        chainId: 1,
        log: { id: String(toCheckpoint.blockTimestamp), ...transferLog },
        block: {
          timestamp: BigInt(toCheckpoint.blockTimestamp),
          number: 16375000n,
        },
        transaction: {},
      },
    ],
    metadata: {
      pageEndCheckpoint: toCheckpoint,
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
  checkpoint: zeroCheckpoint,
} as unknown as SyncGateway;

function createCheckpoint(index: number): Checkpoint {
  return { ...zeroCheckpoint, blockTimestamp: index, blockNumber: index };
}

beforeEach(() => {
  // Restore getEvents to the initial implementation.
  vi.restoreAllMocks();
  syncGatewayService.checkpoint = zeroCheckpoint;
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

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
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
        block: { timestamp: 10n, number: 16375000n },
        transaction: {},
      },
      context: expect.objectContaining({
        db: { TransferEvent: expect.anything(), Supply: expect.anything() },
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

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
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

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
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

test("processEvents() client.readContract", async (context) => {
  const { common, syncStore, indexingStore } = context;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
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
  expect(supplyEvents.length).toBe(1);

  await service.kill();
});

test("processEvents() client.readContract handles errors", async (context) => {
  const { common, syncStore, indexingStore } = context;

  const service = new IndexingService({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    sources,
    networks,
  });

  const spy = vi.spyOn(networks[0], "request");
  spy.mockRejectedValueOnce(new Error("Unexpected error!"));

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
  expect(supplyEvents.length).toBe(1);

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

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
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

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  const checkpoint6 = createCheckpoint(6);
  await service.handleReorg(checkpoint6);

  expect(indexingStoreRevertSpy).toHaveBeenLastCalledWith({
    safeCheckpoint: checkpoint6,
  });

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

  const checkpoint10 = createCheckpoint(10);
  syncGatewayService.checkpoint = checkpoint10;
  await service.processEvents();

  const checkpoint6 = createCheckpoint(6);
  await service.handleReorg(checkpoint6);

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
