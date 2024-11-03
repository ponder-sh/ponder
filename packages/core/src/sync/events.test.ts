import { ALICE, BOB } from "@/_test/constants.js";
import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import {
  getEventsBlock,
  getEventsLog,
  getEventsTrace,
  getRawRPCData,
} from "@/_test/utils.js";
import {
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { checksumAddress, parseEther, zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import {
  type BlockEvent,
  type CallTraceEvent,
  type LogEvent,
  buildEvents,
  decodeEvents,
} from "./events.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

test("decodeEvents() log", async (context) => {
  const { common, sources } = context;

  const rawEvents = await getEventsLog(sources);

  const events = decodeEvents(common, sources, rawEvents, "historical") as [
    LogEvent,
    LogEvent,
    LogEvent,
  ];

  expect(events).toHaveLength(3);
  expect(events[0].event.args).toMatchObject({
    from: zeroAddress,
    to: ALICE,
    amount: parseEther("1"),
  });
  expect(events[0].event.name).toBe(
    "Transfer(address indexed from, address indexed to, uint256 amount)",
  );
  expect(events[1].event.args).toMatchObject({
    from: ALICE,
    to: BOB,
    amount: parseEther("1"),
  });
  expect(events[1].event.name).toBe(
    "Transfer(address indexed from, address indexed to, uint256 amount)",
  );
  expect(events[2].event.args).toMatchObject({
    sender: ALICE,
    to: ALICE,
    amount0Out: 1n,
    amount1Out: 2n,
  });
  expect(events[2].event.name).toBe("Swap");
});

test("decodeEvents() log error", async (context) => {
  const { common, sources } = context;

  const rawEvents = await getEventsLog(sources);

  // remove data from log, causing an error when decoding
  rawEvents[0]!.log!.data = "0x0";
  const events = decodeEvents(common, sources, rawEvents, "historical") as [
    LogEvent,
    LogEvent,
  ];

  expect(events).toHaveLength(2);

  expect(events[0].event.args).toMatchObject({
    from: ALICE,
    to: BOB,
    amount: parseEther("1"),
  });
  expect(events[1].event.args).toMatchObject({
    sender: ALICE,
    to: ALICE,
    amount0Out: 1n,
    amount1Out: 2n,
  });
});

test("decodeEvents() block", async (context) => {
  const { common, sources } = context;

  const rawEvents = await getEventsBlock(sources);

  const events = decodeEvents(common, sources, rawEvents, "historical") as [
    BlockEvent,
  ];

  expect(events).toHaveLength(1);
  expect(events[0].event.block).toMatchObject({
    number: 3n,
  });
});

test("decodeEvents() trace", async (context) => {
  const { common, sources } = context;

  const rawEvents = await getEventsTrace(sources);

  const events = decodeEvents(common, sources, rawEvents, "historical") as [
    CallTraceEvent,
  ];

  expect(events).toHaveLength(1);
  expect(events[0].event.args).toBeUndefined();
  expect(events[0].event.result).toBe(checksumAddress(context.factory.pair));
  expect(events[0].name).toBe("Factory.createPair()");
});

test("decodeEvents() trace error", async (context) => {
  const { common, sources } = context;

  const rawEvents = await getEventsTrace(sources);

  // change function selector, causing an error when decoding
  rawEvents[0]!.trace!.input = "0x0";
  const events = decodeEvents(common, sources, rawEvents, "historical") as [
    CallTraceEvent,
  ];

  expect(events).toHaveLength(0);
});

test("buildEvents() matches getEvents()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertBlocks({
    blocks: [
      rpcData.block1.block,
      rpcData.block2.block,
      rpcData.block3.block,
      rpcData.block4.block,
      rpcData.block5.block,
    ],
    chainId: 1,
  });
  await syncStore.insertLogs({
    logs: [
      { log: rpcData.block2.logs[0], block: rpcData.block2.block },
      { log: rpcData.block2.logs[1], block: rpcData.block2.block },
      { log: rpcData.block3.logs[0], block: rpcData.block3.block },
      { log: rpcData.block4.logs[0], block: rpcData.block4.block },
    ],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });
  await syncStore.insertTransactions({
    transactions: [
      ...rpcData.block2.transactions,
      ...rpcData.block3.transactions,
      ...rpcData.block4.transactions,
    ],
    chainId: 1,
  });
  await syncStore.insertTransactionReceipts({
    transactionReceipts: [
      ...rpcData.block2.transactionReceipts,
      ...rpcData.block3.transactionReceipts,
      ...rpcData.block4.transactionReceipts,
    ],
    chainId: 1,
  });
  await syncStore.insertCallTraces({
    callTraces: [
      { callTrace: rpcData.block2.callTraces[0], block: rpcData.block2.block },
      { callTrace: rpcData.block2.callTraces[1], block: rpcData.block2.block },
      { callTrace: rpcData.block3.callTraces[0], block: rpcData.block3.block },
      { callTrace: rpcData.block4.callTraces[0], block: rpcData.block4.block },
    ],
    chainId: 1,
  });

  const { events: events1 } = await syncStore.getEvents({
    filters: context.sources.map((s) => s.filter),
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  const events2 = [
    ...buildEvents({
      sources: context.sources,
      chainId: 1,
      blockWithEventData: {
        ...rpcData.block1,
        callTraces: [],
      },
      finalizedChildAddresses: new Map([
        [context.sources[1].filter.address, new Set()],
        [context.sources[2].filter.toAddress, new Set()],
      ]),
      unfinalizedChildAddresses: new Map([
        [context.sources[1].filter.address, new Set()],
        [context.sources[2].filter.toAddress, new Set()],
      ]),
    }),
    ...buildEvents({
      sources: context.sources,
      chainId: 1,
      blockWithEventData: {
        ...rpcData.block2,
      },
      finalizedChildAddresses: new Map([
        [context.sources[1].filter.address, new Set()],
        [context.sources[2].filter.toAddress, new Set()],
      ]),
      unfinalizedChildAddresses: new Map([
        [context.sources[1].filter.address, new Set()],
        [context.sources[2].filter.toAddress, new Set()],
      ]),
    }),
    ...buildEvents({
      sources: context.sources,
      chainId: 1,
      blockWithEventData: {
        ...rpcData.block3,
      },
      finalizedChildAddresses: new Map([
        [context.sources[1].filter.address, new Set()],
        [context.sources[2].filter.toAddress, new Set()],
      ]),
      unfinalizedChildAddresses: new Map([
        [context.sources[1].filter.address, new Set()],
        [context.sources[2].filter.toAddress, new Set()],
      ]),
    }),
    ...buildEvents({
      sources: context.sources,
      chainId: 1,
      blockWithEventData: {
        ...rpcData.block4,
      },
      finalizedChildAddresses: new Map([
        [context.sources[1].filter.address, new Set()],
        [context.sources[2].filter.toAddress, new Set()],
      ]),
      unfinalizedChildAddresses: new Map([
        [context.sources[1].filter.address, new Set([context.factory.pair])],
        [context.sources[2].filter.toAddress, new Set([context.factory.pair])],
      ]),
    }),
    ...buildEvents({
      sources: context.sources,
      chainId: 1,
      blockWithEventData: {
        ...rpcData.block5,
      },
      finalizedChildAddresses: new Map([
        [context.sources[1].filter.address, new Set()],
        [context.sources[2].filter.toAddress, new Set()],
      ]),
      unfinalizedChildAddresses: new Map([
        [context.sources[1].filter.address, new Set([context.factory.pair])],
        [context.sources[2].filter.toAddress, new Set([context.factory.pair])],
      ]),
    }),
  ];

  expect(events2).toStrictEqual(events1);

  await cleanup();
});
