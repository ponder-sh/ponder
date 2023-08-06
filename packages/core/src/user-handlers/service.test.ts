import { buildSchema as buildGraphqlSchema } from "graphql";
import { beforeEach, expect, test, vi } from "vitest";

import { usdcContractConfig } from "@/_test/constants";
import { setupEventStore, setupUserStore } from "@/_test/setup";
import { publicClient } from "@/_test/utils";
import type { HandlerFunctions } from "@/build/handlers";
import { schemaHeader } from "@/build/schema";
import { encodeLogFilterKey } from "@/config/logFilterKey";
import type { LogEventMetadata } from "@/config/logFilters";
import { EventAggregatorService } from "@/event-aggregator/service";
import { buildSchema } from "@/schema/schema";

import { EventHandlerService } from "./service";

beforeEach((context) => setupEventStore(context));
beforeEach((context) => setupUserStore(context));

const network = {
  name: "mainnet",
  chainId: 1,
  client: publicClient,
  pollingInterval: 1_000,
  defaultMaxBlockRange: 3,
  finalityBlockCount: 10,
  maxRpcRequestConcurrency: 10,
};

const logFilters = [
  {
    name: "USDC",
    ...usdcContractConfig,
    network: network.name,
    filter: {
      key: encodeLogFilterKey({
        chainId: network.chainId,
        address: usdcContractConfig.address,
      }),
      chainId: network.chainId,
      address: usdcContractConfig.address,
      startBlock: 16369950,
      // Note: the service uses the `finalizedBlockNumber` as the end block if undefined.
      endBlock: undefined,
    },
  },
];

const contracts = [{ name: "USDC", ...usdcContractConfig, network }];

const schema = buildSchema(
  buildGraphqlSchema(`${schemaHeader}
    type TransferEvent @entity {
      id: String!
      blockNumber: Int!
    }
  `)
);

const transferHandler = vi.fn(async ({ event, context }) => {
  await context.entities.TransferEvent.create({
    id: event.log.id,
    data: {
      blockNumber: Number(event.block.number),
    },
  });
});

const transferEventMetadata = usdcContractConfig.events[
  "Transfer"
] as LogEventMetadata;

const handlers: HandlerFunctions = {
  _meta_: {},
  logFilters: {
    USDC: {
      bySelector: {
        [transferEventMetadata.selector]: transferEventMetadata,
      },
      bySafeName: {
        ["Transfer"]: {
          ...transferEventMetadata,
          fn: transferHandler,
        },
      },
    },
  },
};

const getEvents = vi.fn(async function* getEvents({
  // fromBlockNumber,
  toBlockNumber,
}) {
  yield {
    pageEndsAtBlockNumber: toBlockNumber,
    events: [
      {
        logFilterName: "USDC",
        eventName: "Transfer",
        params: { from: "0x0", to: "0x1", amount: 100n },
        log: { id: String(toBlockNumber) },
        block: { number: BigInt(toBlockNumber) },
        transaction: {},
      },
    ],
    counts: [
      {
        logFilterName: "USDC",
        selector: transferEventMetadata.selector,
        count: 5,
      },
    ],
  };
});

const eventAggregatorService = {
  getEvents,
  checkpoint: 0,
} as unknown as EventAggregatorService;

beforeEach(() => {
  // Restore getEvents to the initial implementation.
  vi.restoreAllMocks();
  eventAggregatorService.checkpoint = 0;
});

test("processEvents() calls getEvents with sequential block ranges", async (context) => {
  const { common, eventStore, userStore } = context;

  const service = new EventHandlerService({
    common,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  });

  await service.reset({ schema, handlers });

  expect(getEvents).not.toHaveBeenCalled();

  eventAggregatorService.checkpoint = 10;
  await service.processEvents();

  expect(getEvents).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fromBlockNumber: 0,
      toBlockNumber: 10,
    })
  );

  eventAggregatorService.checkpoint = 50;
  await service.processEvents();

  expect(getEvents).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fromBlockNumber: 11,
      toBlockNumber: 50,
    })
  );

  service.kill();
});

test("processEvents() calls event handler functions with correct arguments", async (context) => {
  const { common, eventStore, userStore } = context;

  const service = new EventHandlerService({
    common,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  });

  await service.reset({ schema, handlers });

  eventAggregatorService.checkpoint = 10;
  await service.processEvents();

  expect(transferHandler).toHaveBeenCalledWith(
    expect.objectContaining({
      event: {
        logFilterName: "USDC",
        eventName: "Transfer",
        params: { from: "0x0", to: "0x1", amount: 100n },
        log: { id: "10" },
        block: { number: 10n },
        transaction: {},
        name: "Transfer",
      },
      context: {
        contracts: { USDC: expect.anything() },
        entities: { TransferEvent: expect.anything() },
      },
    })
  );

  service.kill();
});

test("processEvents() model methods insert data into the user store", async (context) => {
  const { common, eventStore, userStore } = context;

  const service = new EventHandlerService({
    common,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  });

  await service.reset({ schema, handlers });

  eventAggregatorService.checkpoint = 10;
  await service.processEvents();

  const transferEvents = await userStore.findMany({
    modelName: "TransferEvent",
  });
  expect(transferEvents.length).toBe(1);

  service.kill();
});

test("processEvents() updates event count metrics", async (context) => {
  const { common, eventStore, userStore } = context;

  const service = new EventHandlerService({
    common,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  });

  await service.reset({ schema, handlers });

  eventAggregatorService.checkpoint = 10;
  await service.processEvents();

  const matchedEventsMetric = (
    await common.metrics.ponder_handlers_matched_events.get()
  ).values;
  expect(matchedEventsMetric).toMatchObject([
    { labels: { eventName: "setup" }, value: 1 },
    { labels: { eventName: "USDC:Transfer" }, value: 5 },
  ]);

  const handledEventsMetric = (
    await common.metrics.ponder_handlers_handled_events.get()
  ).values;
  expect(handledEventsMetric).toMatchObject([
    { labels: { eventName: "USDC:Transfer" }, value: 5 },
  ]);

  const processedEventsMetric = (
    await common.metrics.ponder_handlers_processed_events.get()
  ).values;
  expect(processedEventsMetric).toMatchObject([
    { labels: { eventName: "USDC:Transfer" }, value: 1 },
  ]);

  service.kill();
});

test("reset() reloads the user store", async (context) => {
  const { common, eventStore, userStore } = context;

  const service = new EventHandlerService({
    common,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  });

  await service.reset({ schema, handlers });

  eventAggregatorService.checkpoint = 10;
  await service.processEvents();

  const transferEvents = await userStore.findMany({
    modelName: "TransferEvent",
  });
  expect(transferEvents.length).toBe(1);

  const versionIdBeforeReset = userStore.versionId;

  await service.reset({ schema, handlers });

  expect(userStore.versionId).not.toBe(versionIdBeforeReset);

  const transferEventsAfterReset = await userStore.findMany({
    modelName: "TransferEvent",
  });
  expect(transferEventsAfterReset.length).toBe(0);

  service.kill();
});

test("handleReorg() updates ponder_handlers_latest_processed_block_number metric", async (context) => {
  const { common, eventStore, userStore } = context;

  const service = new EventHandlerService({
    common,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  });

  await service.reset({ schema, handlers });

  eventAggregatorService.checkpoint = 10;
  await service.processEvents();

  const latestProcessedBlockNumberMetric = (
    await common.metrics.ponder_handlers_latest_processed_block_number.get()
  ).values[0].value;
  expect(latestProcessedBlockNumberMetric).toBe(10);

  await service.reset({ schema, handlers });

  const latestProcessedBlockNumberMetricAfterReset = (
    await common.metrics.ponder_handlers_latest_processed_block_number.get()
  ).values[0].value;
  expect(latestProcessedBlockNumberMetricAfterReset).toBe(0);

  service.kill();
});

test("handleReorg() reverts the user store", async (context) => {
  const { common, eventStore, userStore } = context;

  const service = new EventHandlerService({
    common,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  });

  const userStoreRevertSpy = vi.spyOn(userStore, "revert");

  await service.reset({ schema, handlers });

  eventAggregatorService.checkpoint = 10;
  await service.processEvents();

  await service.handleReorg({ commonAncestorBlockNumber: 6 });

  expect(userStoreRevertSpy).toHaveBeenLastCalledWith({ safeBlockNumber: 6 });

  service.kill();
});

test("handleReorg() does nothing if there is a user error", async (context) => {
  const { common, eventStore, userStore } = context;

  const service = new EventHandlerService({
    common,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  });

  const userStoreRevertSpy = vi.spyOn(userStore, "revert");

  await service.reset({ schema, handlers });

  transferHandler.mockImplementationOnce(() => {
    throw new Error("User error!");
  });

  eventAggregatorService.checkpoint = 10;
  await service.processEvents();

  await service.handleReorg({ commonAncestorBlockNumber: 6 });

  expect(userStoreRevertSpy).not.toHaveBeenCalled();

  service.kill();
});

test("handleReorg() processes the correct range of events after a reorg", async (context) => {
  const { common, eventStore, userStore } = context;

  const service = new EventHandlerService({
    common,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  });

  await service.reset({ schema, handlers });

  eventAggregatorService.checkpoint = 10;
  await service.processEvents();

  expect(getEvents).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fromBlockNumber: 0,
      toBlockNumber: 10,
    })
  );

  // This simulates a scenario where there was a reorg back to 6
  // and the new latest block is 9.
  eventAggregatorService.checkpoint = 9;
  await service.handleReorg({ commonAncestorBlockNumber: 6 });
  await service.processEvents();

  expect(getEvents).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fromBlockNumber: 7,
      toBlockNumber: 9,
    })
  );

  service.kill();
});

test("handleReorg() updates ponder_handlers_latest_processed_block_number metric", async (context) => {
  const { common, eventStore, userStore } = context;

  const service = new EventHandlerService({
    common,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  });

  await service.reset({ schema, handlers });

  eventAggregatorService.checkpoint = 10;
  await service.processEvents();

  const latestProcessedBlockNumberMetric = (
    await common.metrics.ponder_handlers_latest_processed_block_number.get()
  ).values[0].value;
  expect(latestProcessedBlockNumberMetric).toBe(10);

  // This simulates a scenario where there was a reorg back to 6
  // and the new latest block is 9.
  eventAggregatorService.checkpoint = 9;
  await service.handleReorg({ commonAncestorBlockNumber: 6 });

  const latestProcessedBlockNumberMetricAfterReorg = (
    await common.metrics.ponder_handlers_latest_processed_block_number.get()
  ).values[0].value;
  expect(latestProcessedBlockNumberMetricAfterReorg).toBe(6);

  service.kill();
});
