import { ALICE, BOB } from "@/_test/constants.js";
import { setupAnvil, setupCommon } from "@/_test/setup.js";
import { getEventsBlock, getEventsLog, getEventsTrace } from "@/_test/utils.js";
import { checksumAddress, parseEther, zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import {
  type BlockEvent,
  type FunctionCallEvent,
  type LogEvent,
  decodeEvents,
} from "./events.js";
import type { Service } from "./service.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);

test("decodeEvents() log", async (context) => {
  const { common, sources } = context;

  const sourceById = sources.reduce<Service["sourceById"]>((acc, cur) => {
    acc[cur.id] = cur;
    return acc;
  }, {});

  const rawEvents = await getEventsLog(sources);

  const events = decodeEvents({ common, sourceById }, rawEvents) as [
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
  expect(events[0].logEventName).toBe(
    "Transfer(address indexed from, address indexed to, uint256 amount)",
  );
  expect(events[1].event.args).toMatchObject({
    from: ALICE,
    to: BOB,
    amount: parseEther("1"),
  });
  expect(events[1].logEventName).toBe(
    "Transfer(address indexed from, address indexed to, uint256 amount)",
  );
  expect(events[2].event.args).toMatchObject({
    sender: ALICE,
    to: ALICE,
    amount0Out: 1n,
    amount1Out: 2n,
  });
  expect(events[2].logEventName).toBe("Swap");
});

test("decodeEvents() log error", async (context) => {
  const { common, sources } = context;

  const sourceById = sources.reduce<Service["sourceById"]>((acc, cur) => {
    acc[cur.id] = cur;
    return acc;
  }, {});

  const rawEvents = await getEventsLog(sources);

  // remove data from log, causing an error when decoding
  rawEvents[0].log!.data = "0x0";
  const events = decodeEvents({ common, sourceById }, rawEvents) as [
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

  const sourceById = sources.reduce<Service["sourceById"]>((acc, cur) => {
    acc[cur.id] = cur;
    return acc;
  }, {});

  const rawEvents = await getEventsBlock(sources);

  const events = decodeEvents({ common, sourceById }, rawEvents) as [
    BlockEvent,
  ];

  expect(events).toHaveLength(1);
  expect(events[0].event.block).toMatchObject({
    number: 3n,
  });
});

test("decodeEvents() trace", async (context) => {
  const { common, sources } = context;

  const sourceById = sources.reduce<Service["sourceById"]>((acc, cur) => {
    acc[cur.id] = cur;
    return acc;
  }, {});

  const rawEvents = await getEventsTrace(sources);

  const events = decodeEvents({ common, sourceById }, rawEvents) as [
    FunctionCallEvent,
  ];

  expect(events).toHaveLength(1);
  expect(events[0].event.args).toBeUndefined();
  expect(events[0].event.result).toBe(checksumAddress(context.factory.pair));
  expect(events[0].functionName).toBe("createPair()");
});

test("decodeEvents() trace error", async (context) => {
  const { common, sources } = context;

  const sourceById = sources.reduce<Service["sourceById"]>((acc, cur) => {
    acc[cur.id] = cur;
    return acc;
  }, {});

  const rawEvents = await getEventsTrace(sources);

  // change function selector, causing an error when decoding
  rawEvents[0].trace!.input = "0x0";
  const events = decodeEvents({ common, sourceById }, rawEvents) as [
    FunctionCallEvent,
  ];

  expect(events).toHaveLength(0);
});
