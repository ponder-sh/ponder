import { buildSchema as buildGraphqlSchema } from "graphql";
import { getAbiItem, getEventSelector } from "viem";
import { beforeEach, expect, test, vi } from "vitest";

import { usdcContractConfig } from "@/_test/constants";
import { setupEventStore, setupUserStore } from "@/_test/setup";
import { publicClient } from "@/_test/utils";
import { schemaHeader } from "@/build/schema";
import { encodeLogFilterKey } from "@/config/logFilterKey";
import { LogFilter } from "@/config/logFilters";
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
};

const logFilters: LogFilter[] = [
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
      timestamp: Int!
    }
  `)
);

const transferHandler = vi.fn(async ({ event, context }) => {
  await context.entities.TransferEvent.create({
    id: event.log.id,
    data: {
      timestamp: Number(event.block.timestamp),
    },
  });
});

const handlers = {
  USDC: {
    Transfer: transferHandler,
  },
};

const handledLogFilters = {
  USDC: [
    {
      eventName: "Transfer",
      topic0: getEventSelector(
        "Transfer(address indexed from, address indexed to, uint256 amount)"
      ),
      abiItem: getAbiItem({
        abi: usdcContractConfig.abi,
        name: "Transfer",
      }),
    },
  ],
};

const getEvents = vi.fn(({ fromTimestamp, toTimestamp }) => ({
  totalEventCount: toTimestamp - fromTimestamp,
  events: [
    {
      logFilterName: "USDC",
      eventName: "Transfer",
      params: { from: "0x0", to: "0x1", amount: 100n },
      log: { id: String(toTimestamp) },
      block: { timestamp: BigInt(toTimestamp) },
      transaction: {},
    },
  ],
}));

const eventAggregatorService = {
  getEvents,
  checkpoint: 0,
} as unknown as EventAggregatorService;

beforeEach(() => {
  // Restore getEvents to the initial implementation.
  vi.restoreAllMocks();
  eventAggregatorService.checkpoint = 0;
});

test("processEvents() calls getEvents with sequential timestamp ranges", async (context) => {
  const { resources, eventStore, userStore } = context;

  const service = new EventHandlerService({
    resources,
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

  expect(getEvents).toHaveBeenLastCalledWith({
    fromTimestamp: 0,
    toTimestamp: 10,
    handledLogFilters,
  });

  eventAggregatorService.checkpoint = 50;
  await service.processEvents();

  expect(getEvents).toHaveBeenLastCalledWith({
    fromTimestamp: 11,
    toTimestamp: 50,
    handledLogFilters,
  });

  service.kill();
});

test("processEvents() calls event handler functions with correct arguments", async (context) => {
  const { resources, eventStore, userStore } = context;

  const service = new EventHandlerService({
    resources,
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
        block: { timestamp: 10n },
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
  const { resources, eventStore, userStore } = context;

  const service = new EventHandlerService({
    resources,
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
  const { resources, eventStore, userStore } = context;

  const service = new EventHandlerService({
    resources,
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
    await resources.metrics.ponder_handlers_matched_events.get()
  ).values[0].value;
  expect(matchedEventsMetric).toBe(10);

  const handledEventsMetric = (
    await resources.metrics.ponder_handlers_handled_events.get()
  ).values;
  expect(handledEventsMetric).toMatchObject([
    { labels: { eventName: "USDC:Transfer" }, value: 1 },
  ]);

  const processedEventsMetric = (
    await resources.metrics.ponder_handlers_processed_events.get()
  ).values;
  expect(processedEventsMetric).toMatchObject([
    { labels: { eventName: "USDC:Transfer" }, value: 1 },
  ]);

  service.kill();
});

test("reset() reloads the user store", async (context) => {
  const { resources, eventStore, userStore } = context;

  const service = new EventHandlerService({
    resources,
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

test("handleReorg() updates ponder_handlers_latest_processed_timestamp metric", async (context) => {
  const { resources, eventStore, userStore } = context;

  const service = new EventHandlerService({
    resources,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  });

  await service.reset({ schema, handlers });

  eventAggregatorService.checkpoint = 10;
  await service.processEvents();

  const latestProcessedTimestampMetric = (
    await resources.metrics.ponder_handlers_latest_processed_timestamp.get()
  ).values[0].value;
  expect(latestProcessedTimestampMetric).toBe(10);

  await service.reset({ schema, handlers });

  const latestProcessedTimestampMetricAfterReset = (
    await resources.metrics.ponder_handlers_latest_processed_timestamp.get()
  ).values[0].value;
  expect(latestProcessedTimestampMetricAfterReset).toBe(0);

  service.kill();
});

test("handleReorg() reverts the user store", async (context) => {
  const { resources, eventStore, userStore } = context;

  const service = new EventHandlerService({
    resources,
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

  await service.handleReorg({ commonAncestorTimestamp: 6 });

  expect(userStoreRevertSpy).toHaveBeenLastCalledWith({ safeTimestamp: 6 });

  service.kill();
});

test("handleReorg() does nothing if there is a user error", async (context) => {
  const { resources, eventStore, userStore } = context;

  const service = new EventHandlerService({
    resources,
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

  await service.handleReorg({ commonAncestorTimestamp: 6 });

  expect(userStoreRevertSpy).not.toHaveBeenCalled();

  service.kill();
});

test("handleReorg() processes the correct range of events after a reorg", async (context) => {
  const { resources, eventStore, userStore } = context;

  const service = new EventHandlerService({
    resources,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  });

  await service.reset({ schema, handlers });

  eventAggregatorService.checkpoint = 10;
  await service.processEvents();

  expect(getEvents).toHaveBeenLastCalledWith({
    fromTimestamp: 0,
    toTimestamp: 10,
    handledLogFilters,
  });

  // This simulates a scenario where there was a reorg back to 6
  // and the new latest block is 9.
  eventAggregatorService.checkpoint = 9;
  await service.handleReorg({ commonAncestorTimestamp: 6 });
  await service.processEvents();

  expect(getEvents).toHaveBeenLastCalledWith({
    fromTimestamp: 7,
    toTimestamp: 9,
    handledLogFilters,
  });

  service.kill();
});

test("handleReorg() updates ponder_handlers_latest_processed_timestamp metric", async (context) => {
  const { resources, eventStore, userStore } = context;

  const service = new EventHandlerService({
    resources,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  });

  await service.reset({ schema, handlers });

  eventAggregatorService.checkpoint = 10;
  await service.processEvents();

  const latestProcessedTimestampMetric = (
    await resources.metrics.ponder_handlers_latest_processed_timestamp.get()
  ).values[0].value;
  expect(latestProcessedTimestampMetric).toBe(10);

  // This simulates a scenario where there was a reorg back to 6
  // and the new latest block is 9.
  eventAggregatorService.checkpoint = 9;
  await service.handleReorg({ commonAncestorTimestamp: 6 });

  const latestProcessedTimestampMetricAfterReorg = (
    await resources.metrics.ponder_handlers_latest_processed_timestamp.get()
  ).values[0].value;
  expect(latestProcessedTimestampMetricAfterReorg).toBe(6);

  service.kill();
});
