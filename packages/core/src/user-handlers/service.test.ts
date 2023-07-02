import { buildSchema as buildGraphqlSchema } from "graphql";
import { getAbiItem, getEventSelector } from "viem";
import { beforeEach, expect, test, vi } from "vitest";

import { usdcContractConfig } from "@/_test/constants";
import { setupEventStore, setupUserStore } from "@/_test/setup";
import { publicClient, testResources } from "@/_test/utils";
import { encodeLogFilterKey } from "@/config/logFilterKey";
import { LogFilter } from "@/config/logFilters";
import { EventAggregatorService } from "@/event-aggregator/service";
import { schemaHeader } from "@/reload/readGraphqlSchema";
import { buildSchema } from "@/schema/schema";

import { EventHandlerService } from "./service";

beforeEach(setupEventStore);
beforeEach(setupUserStore);

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
    type TestEntity @entity {
      id: String!
    }
  `)
);

const transferHandler = vi.fn();

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

const getEvents = vi.fn(() => ({
  totalEventCount: 5,
  events: [
    {
      logFilterName: "USDC",
      eventName: "Transfer",
      params: {},
      log: {},
      block: {},
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

test("processEvents() calls event handler functions", async (context) => {
  const { eventStore, userStore } = context;

  const service = new EventHandlerService({
    resources: testResources,
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
        params: {},
        log: {},
        block: {},
        transaction: {},
        name: "Transfer",
      },
      context: {
        contracts: expect.anything(),
        entities: expect.anything(),
      },
    })
  );

  service.kill();
});

test("processEvents() calls getEvents with expected parameters", async (context) => {
  const { eventStore, userStore } = context;

  const service = new EventHandlerService({
    resources: testResources,
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

  eventAggregatorService.checkpoint = 50;
  await service.processEvents();

  expect(getEvents).toHaveBeenLastCalledWith({
    fromTimestamp: 11,
    toTimestamp: 50,
    handledLogFilters,
  });

  service.kill();
});

test("reset() processes events after resetting", async (context) => {
  const { eventStore, userStore } = context;

  const service = new EventHandlerService({
    resources: testResources,
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

  eventAggregatorService.checkpoint = 15;
  await service.reset({ schema, handlers });

  expect(getEvents).toHaveBeenLastCalledWith({
    fromTimestamp: 0,
    toTimestamp: 15,
    handledLogFilters,
  });

  service.kill();
});

test("handleReorg() reverts the user store", async (context) => {
  const { eventStore, userStore } = context;

  const userStoreRevertSpy = vi.spyOn(userStore, "revert");

  const service = new EventHandlerService({
    resources: testResources,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  });

  await service.reset({ schema, handlers });

  eventAggregatorService.checkpoint = 10;
  await service.processEvents();

  await service.handleReorg({ commonAncestorTimestamp: 6 });

  expect(userStoreRevertSpy).toHaveBeenLastCalledWith({ safeTimestamp: 6 });

  service.kill();
});

test("handleReorg() processes events between the reorg timestamp and the checkpoint", async (context) => {
  const { eventStore, userStore } = context;

  const service = new EventHandlerService({
    resources: testResources,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  });

  await service.reset({ schema, handlers });

  eventAggregatorService.checkpoint = 10;
  await service.processEvents();

  // This simulates a scenario where there was a reorg back to 6
  // and the new latest block is 9.
  eventAggregatorService.checkpoint = 9;
  await service.handleReorg({ commonAncestorTimestamp: 6 });

  expect(getEvents).toHaveBeenLastCalledWith({
    fromTimestamp: 7,
    toTimestamp: 9,
    handledLogFilters,
  });

  service.kill();
});
