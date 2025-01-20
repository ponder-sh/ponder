import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import {
  getBlocksConfigAndIndexingFunctions,
  getNetwork,
  testClient,
} from "@/_test/utils.js";
import { buildConfigAndIndexingFunctions } from "@/build/configAndIndexingFunctions.js";
import type { RawEvent } from "@/internal/types.js";
import {
  MAX_CHECKPOINT_STRING,
  ZERO_CHECKPOINT_STRING,
  decodeCheckpoint,
} from "@/utils/checkpoint.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
import { promiseWithResolvers } from "@ponder/common";
import { beforeEach, expect, test, vi } from "vitest";
import { createSyncOmnichain, mergeEventGenerators } from "./omnichain.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

test("createSyncOmnichain()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const sync = await createSyncOmnichain({
    common: context.common,
    indexingBuild: { sources, networks: [network] },
    requestQueues: [createRequestQueue({ network, common: context.common })],
    syncStore,
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: ZERO_CHECKPOINT_STRING,
  });

  expect(sync).toBeDefined();

  await sync.kill();

  await cleanup();
});

test("mergeEventGenerators()", async () => {
  const p1 = promiseWithResolvers<{ events: RawEvent[]; checkpoint: string }>();
  const p2 = promiseWithResolvers<{ events: RawEvent[]; checkpoint: string }>();
  const p3 = promiseWithResolvers<{ events: RawEvent[]; checkpoint: string }>();
  const p4 = promiseWithResolvers<{ events: RawEvent[]; checkpoint: string }>();

  async function* generator1() {
    yield await p1.promise;
    yield await p2.promise;
  }

  async function* generator2() {
    yield await p3.promise;
    yield await p4.promise;
  }

  const results: { events: RawEvent[]; checkpoint: string }[] = [];
  const generator = mergeEventGenerators([generator1(), generator2()]);

  (async () => {
    for await (const result of generator) {
      results.push(result);
    }
  })();

  p1.resolve({
    events: [{ checkpoint: "01" }, { checkpoint: "07" }] as RawEvent[],
    checkpoint: "10",
  });
  p3.resolve({
    events: [{ checkpoint: "02" }, { checkpoint: "05" }] as RawEvent[],
    checkpoint: "06",
  });

  await new Promise((res) => setTimeout(res));

  p4.resolve({
    events: [{ checkpoint: "08" }, { checkpoint: "11" }] as RawEvent[],
    checkpoint: "20",
  });
  p2.resolve({
    events: [{ checkpoint: "08" }, { checkpoint: "13" }] as RawEvent[],
    checkpoint: "20",
  });

  await new Promise((res) => setTimeout(res));

  expect(results).toMatchInlineSnapshot(`
    [
      {
        "checkpoint": "06",
        "events": [
          {
            "checkpoint": "01",
          },
          {
            "checkpoint": "02",
          },
          {
            "checkpoint": "05",
          },
        ],
      },
      {
        "checkpoint": "10",
        "events": [
          {
            "checkpoint": "07",
          },
          {
            "checkpoint": "08",
          },
        ],
      },
      {
        "checkpoint": "20",
        "events": [
          {
            "checkpoint": "08",
          },
          {
            "checkpoint": "11",
          },
          {
            "checkpoint": "13",
          },
        ],
      },
    ]
  `);
});

test("getEvents()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  network.finalityBlockCount = 0;

  const sync = await createSyncOmnichain({
    syncStore,
    common: context.common,
    indexingBuild: { sources, networks: [network] },
    requestQueues: [createRequestQueue({ network, common: context.common })],
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: ZERO_CHECKPOINT_STRING,
  });

  const events = await drainAsyncGenerator(sync.getEvents()).then((events) =>
    events.flat(),
  );

  expect(events).toBeDefined();
  expect(events).toHaveLength(2);

  await sync.kill();

  await cleanup();
});

test("getEvents() updates status", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 2 });

  // finalized block: 2
  network.finalityBlockCount = 0;

  const sync = await createSyncOmnichain({
    syncStore,

    common: context.common,
    indexingBuild: { sources, networks: [network] },
    requestQueues: [createRequestQueue({ network, common: context.common })],
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: ZERO_CHECKPOINT_STRING,
  });

  await drainAsyncGenerator(sync.getEvents());

  const status = sync.getStatus();

  expect(status[network.chainId]?.ready).toBe(false);
  expect(status[network.chainId]?.block?.number).toBe(2);

  await sync.kill();

  await cleanup();
});

test("getEvents() with initial checkpoint", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 2 });

  // finalized block: 2
  network.finalityBlockCount = 0;

  const sync = await createSyncOmnichain({
    syncStore,

    common: context.common,
    indexingBuild: { sources, networks: [network] },
    requestQueues: [createRequestQueue({ network, common: context.common })],
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: MAX_CHECKPOINT_STRING,
  });

  const events = await drainAsyncGenerator(sync.getEvents()).then((events) =>
    events.flat(),
  );

  expect(events).toBeDefined();
  expect(events).toHaveLength(0);

  await sync.kill();

  await cleanup();
});

test("startRealtime()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 2 });

  const sync = await createSyncOmnichain({
    syncStore,

    common: context.common,
    indexingBuild: { sources, networks: [network] },
    requestQueues: [createRequestQueue({ network, common: context.common })],
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: ZERO_CHECKPOINT_STRING,
  });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  const status = sync.getStatus();

  expect(status[network.chainId]?.ready).toBe(true);
  expect(status[network.chainId]?.block?.number).toBe(1);

  await sync.kill();

  await cleanup();
});

test("onEvent() handles block", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const promise = promiseWithResolvers<void>();
  const events: RawEvent[] = [];

  await testClient.mine({ blocks: 1 });

  const sync = await createSyncOmnichain({
    syncStore,

    common: context.common,
    indexingBuild: { sources, networks: [network] },
    requestQueues: [createRequestQueue({ network, common: context.common })],
    onRealtimeEvent: async (event) => {
      if (event.type === "block") {
        events.push(...event.events);
        promise.resolve();
      }
    },
    onFatalError: () => {},
    initialCheckpoint: ZERO_CHECKPOINT_STRING,
  });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  await promise.promise;

  expect(events).toHaveLength(1);

  await sync.kill();

  await cleanup();
});

test("onEvent() handles block with multiple chains", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources: sources1, networks: networks1 } =
    await buildConfigAndIndexingFunctions({
      config,
      rawIndexingFunctions,
    });

  const { sources: sources2, networks: networks2 } =
    await buildConfigAndIndexingFunctions({
      config,
      rawIndexingFunctions,
    });

  // finalized block: 0

  sources2[0]!.filter.chainId = 2;
  networks2[0]!.chainId = 2;

  const promise = promiseWithResolvers<void>();

  const sync = await createSyncOmnichain({
    common: context.common,
    indexingBuild: {
      sources: [...sources1, ...sources2],
      networks: [...networks1, ...networks2],
    },
    requestQueues: [
      createRequestQueue({ network: networks1[0]!, common: context.common }),
      createRequestQueue({ network: networks2[0]!, common: context.common }),
    ],
    syncStore,
    onRealtimeEvent: async (event) => {
      if (event.type === "block") {
        promise.resolve();
      }
    },
    onFatalError: () => {},
    initialCheckpoint: ZERO_CHECKPOINT_STRING,
  });

  await testClient.mine({ blocks: 1 });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  await promise.promise;

  await sync.kill();

  await cleanup();
});

test("onEvent() handles finalize", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const promise = promiseWithResolvers<void>();
  let checkpoint: string;

  // finalized block: 0

  network.finalityBlockCount = 2;

  const sync = await createSyncOmnichain({
    syncStore,

    common: context.common,
    indexingBuild: { sources, networks: [network] },
    requestQueues: [createRequestQueue({ network, common: context.common })],
    onRealtimeEvent: async (event) => {
      if (event.type === "finalize") {
        checkpoint = event.checkpoint;
        promise.resolve();
      }
    },
    onFatalError: () => {},
    initialCheckpoint: ZERO_CHECKPOINT_STRING,
  });

  await testClient.mine({ blocks: 4 });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  await promise.promise;

  expect(decodeCheckpoint(checkpoint!).blockNumber).toBe(2n);

  await sync.kill();

  await cleanup();
});

test.todo("onEvent() handles reorg");

test("onEvent() handles errors", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const promise = promiseWithResolvers<void>();

  // finalized block: 0

  const sync = await createSyncOmnichain({
    syncStore,

    common: context.common,
    indexingBuild: { sources, networks: [network] },
    requestQueues: [createRequestQueue({ network, common: context.common })],
    onRealtimeEvent: async () => {},
    onFatalError: () => {
      promise.resolve();
    },
    initialCheckpoint: ZERO_CHECKPOINT_STRING,
  });

  await testClient.mine({ blocks: 4 });

  await drainAsyncGenerator(sync.getEvents());

  const spy = vi.spyOn(syncStore, "insertTransactions");
  spy.mockRejectedValue(new Error());

  await sync.startRealtime();

  await promise.promise;

  await sync.kill();

  await cleanup();
});
