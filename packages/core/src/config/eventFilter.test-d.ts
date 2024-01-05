import { parseAbiItem } from "viem";
import { test } from "vitest";
import type { GetEventFilter } from "./eventFilter.js";

const event0 = parseAbiItem("event Event0(bytes32 indexed arg)");
const event1 = parseAbiItem("event Event1()");
const event1Overloaded = parseAbiItem("event Event1(bytes32 indexed arg)");
const func = parseAbiItem("function func()");

const abi = [event0, event1, event1Overloaded, func] as const;

const eventFilter = <const contract>(e: GetEventFilter<contract>) => e;

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

test("event filter with list of events");

test("event filter with event", () => {
  eventFilter({
    abi,

    filter: {
      event: "Event1(bytes32 indexed arg)",
    },
  });
});

test("event filter with invalid event", () => {
  eventFilter({
    filter: {
      abi,

      // @ts-expect-error
      event: "made up",
      args: undefined,
    },
  });
});

test("event filter with event and args", () => {
  eventFilter({
    filter: {
      abi,

      event: "Event1(bytes32 indexed arg)",
      args: {
        arg: "0x",
      },
    },
  });
});

test("event filter with weak abi");
