import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import {
  setupCleanup,
  setupCommon,
  setupDatabase,
  setupPonder,
} from "@/_test/setup.js";
import {
  getAccountsConfigAndIndexingFunctions,
  getBlocksConfigAndIndexingFunctions,
  getErc20ConfigAndIndexingFunctions,
} from "@/_test/utils.js";
import type {
  BlockEvent,
  LogEvent,
  RawEvent,
  TraceEvent,
  TransferEvent,
} from "@/internal/types.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import {
  type Hex,
  encodeEventTopics,
  padHex,
  parseEther,
  toHex,
  zeroAddress,
} from "viem";
import { encodeFunctionData, encodeFunctionResult } from "viem/utils";
import { beforeEach, expect, test } from "vitest";
import { decodeEvents } from "./events.js";

beforeEach(setupCommon);
beforeEach(setupDatabase);
beforeEach(setupCleanup);

test("decodeEvents() log", async (context) => {
  const { config, indexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address: zeroAddress,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const topics = encodeEventTopics({
    abi: erc20ABI,
    eventName: "Transfer",
    args: {
      from: zeroAddress,
      to: ALICE,
    },
  });

  const data = padHex(toHex(parseEther("1")), { size: 32 });

  const rawEvent = {
    checkpoint: ZERO_CHECKPOINT_STRING,
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0],
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: { data, topics },
  } as RawEvent;

  const events = decodeEvents(app, { rawEvents: [rawEvent] }) as [LogEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.args).toMatchObject({
    from: zeroAddress,
    to: ALICE,
    amount: parseEther("1"),
  });
});

test("decodeEvents() log error", async (context) => {
  const { config, indexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address: zeroAddress,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const topics = encodeEventTopics({
    abi: erc20ABI,
    eventName: "Transfer",
    args: {
      from: zeroAddress,
      to: ALICE,
    },
  });

  // invalid log.data, causing an error when decoding
  const rawEvent = {
    checkpoint: ZERO_CHECKPOINT_STRING,
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0],
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: {
      data: "0x0" as Hex,
      topics,
    },
  } as RawEvent;

  const events = decodeEvents(app, { rawEvents: [rawEvent] }) as [LogEvent];

  expect(events).toHaveLength(0);
});

test("decodeEvents() block", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const rawEvent = {
    checkpoint: ZERO_CHECKPOINT_STRING,
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0],
    block: {
      number: 1n,
    } as RawEvent["block"],
    transaction: undefined,
    log: undefined,
  } as RawEvent;

  const events = decodeEvents(app, { rawEvents: [rawEvent] }) as [BlockEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.block).toMatchObject({
    number: 1n,
  });
});

test("decodeEvents() transfer", async (context) => {
  const { config, indexingFunctions } = getAccountsConfigAndIndexingFunctions({
    address: ALICE,
  });

  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const rawEvent = {
    checkpoint: ZERO_CHECKPOINT_STRING,
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[3],
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: {
      type: "CALL",
      from: ALICE,
      to: BOB,
      gas: 0n,
      gasUsed: 0n,
      input: "0x0",
      output: "0x0",
      value: parseEther("1"),
      traceIndex: 0,
      subcalls: 0,
      blockNumber: 0,
      transactionIndex: 0,
    },
  } as RawEvent;

  const events = decodeEvents(app, { rawEvents: [rawEvent] }) as [
    TransferEvent,
  ];

  expect(events).toHaveLength(1);
  expect(events[0].event.transfer).toMatchObject({
    from: ALICE,
    to: BOB,
    value: parseEther("1"),
  });
  expect(events[0].eventCallback.name).toBe("Accounts:transfer:from");
});

test("decodeEvents() transaction", async (context) => {
  const { config, indexingFunctions } = getAccountsConfigAndIndexingFunctions({
    address: ALICE,
  });

  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const rawEvent = {
    checkpoint: ZERO_CHECKPOINT_STRING,
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0],
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: undefined,
  } as RawEvent;

  const events = decodeEvents(app, { rawEvents: [rawEvent] }) as [
    TransferEvent,
  ];

  expect(events).toHaveLength(1);

  expect(events[0].eventCallback.name).toBe("Accounts:transaction:to");
});

test("decodeEvents() trace", async (context) => {
  const { config, indexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address: zeroAddress,
    includeCallTraces: true,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const rawEvent = {
    checkpoint: ZERO_CHECKPOINT_STRING,
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[1],
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: {
      type: "CALL",
      from: ALICE,
      to: BOB,
      input: encodeFunctionData({
        abi: erc20ABI,
        functionName: "transfer",
        args: [BOB, parseEther("1")],
      }),
      output: encodeFunctionResult({
        abi: erc20ABI,
        functionName: "transfer",
        result: true,
      }),
      gas: 0n,
      gasUsed: 0n,
      value: 0n,
      traceIndex: 0,
      subcalls: 0,
      blockNumber: 0,
      transactionIndex: 0,
    },
  } as RawEvent;

  const events = decodeEvents(app, { rawEvents: [rawEvent] }) as [TraceEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.args).toStrictEqual([BOB, parseEther("1")]);
  expect(events[0].event.result).toBe(true);
  expect(events[0].eventCallback.name).toBe("Erc20.transfer()");
});

test("decodeEvents() trace error", async (context) => {
  const { config, indexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address: zeroAddress,
    includeCallTraces: true,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const rawEvent = {
    checkpoint: ZERO_CHECKPOINT_STRING,
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[1],
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: {
      type: "CALL",
      from: ALICE,
      to: BOB,
      input: "0x",
      output: encodeFunctionResult({
        abi: erc20ABI,
        functionName: "transfer",
        result: true,
      }),
      gas: 0n,
      gasUsed: 0n,
      value: 0n,
      traceIndex: 0,
      subcalls: 0,
      blockNumber: 0,
      transactionIndex: 0,
    },
  } as RawEvent;

  const events = decodeEvents(app, { rawEvents: [rawEvent] }) as [TraceEvent];

  expect(events).toHaveLength(0);
});
