import { type Abi, parseAbiItem } from "viem";
import { test } from "vitest";
import type { GetEventFilter } from "./eventFilter.js";

const event0 = parseAbiItem("event Event0(bytes32 indexed arg)");
const event1 = parseAbiItem("event Event1()");
const event1Overloaded = parseAbiItem("event Event1(bytes32 indexed arg)");
const func = parseAbiItem("function func()");

const abi = [event0, event1, event1Overloaded, func] as const;

const eventFilter = <const contract>(
  e: contract extends { abi: infer abi extends Abi }
    ? GetEventFilter<abi, contract> & { abi: Abi }
    : contract,
) => e as contract;

test("no event filter", () => {
  eventFilter({});
});

test("event filter with no event", () => {
  eventFilter({
    abi,
    // @ts-expect-error
    filter: {},
  });
});

test("event filter with list of events", () => {
  eventFilter({
    abi,

    filter: {
      event: ["Event0"],
    },
  });
});

test("event filter with invalid list of events", () => {
  eventFilter({
    abi,

    filter: {
      // @ts-expect-error
      event: ["Evnt0"],
    },
  });
});

test("event filter with list of events with args", () => {
  eventFilter({
    abi,

    filter: {
      event: ["Event0"],
      // @ts-expect-error
      args: undefined,
    },
  });
});

test("event filter with event", () => {
  eventFilter({
    abi,

    filter: {
      event: "Event1()",
    },
  });
});

test("event filter with invalid event", () => {
  eventFilter({
    abi,
    filter: {
      // @ts-expect-error
      event: "made up",
      args: undefined,
    },
  });
});

test("event filter with extra parameter", () => {
  eventFilter({
    abi,
    filter: {
      // @ts-expect-error
      a: 0,
      event: "Event1()",
    },
  });
});

test("event filter with event and args", () => {
  eventFilter({
    abi,

    filter: {
      event: "Event0",
      args: {
        arg: "0x",
      },
    },
  });
});

test("event filter with weak abi", () => {
  eventFilter({
    abi: [] as Abi,

    filter: {
      event: "Event0",
      args: {
        arg: "0x",
      },
    },
  });
});
