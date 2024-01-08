import { type AbiEvent, parseAbiItem } from "abitype";
import { test } from "vitest";
import type { GetAddress } from "./address.js";

const address = <const contract>(
  c: contract extends {
    factory?: unknown;
  }
    ? GetAddress<contract>
    : contract,
) => c;

const event0 = parseAbiItem(
  "event Event0(bytes32 indexed arg, bytes32 indexed arg1)",
);
const func = parseAbiItem("function func()");

test("no address or factory", () => {
  address({});
  //^?
});

test("address", () => {
  address({ address: "0x" });
  //    ^?
});

test("factory", () => {
  address({
    // ^?
    factory: {
      address: "0x",
      event: event0,
      parameter: "arg",
    },
  });
});

test("factory with invalid event", () => {
  address({
    // ^?
    factory: {
      address: "0x",
      // @ts-expect-error
      event: func,
      parameter: "arg",
    },
  });
});

test("factory with weak event", () => {
  address({
    // ^?
    factory: {
      address: "0x",
      event: {} as AbiEvent,
      parameter: "arg",
    },
  });
});

test("factory with extra parameter", () => {
  address({
    // ^?
    factory: {
      address: "0x",
      event: event0,
      parameter: "arg",

      // @ts-expect-error
      a: 0,
    },
  });
});

test("address and factory", () => {
  address({
    //  ^?
    // @ts-expect-error
    address: "0x",
    factory: {
      address: "0x",
      event: event0,
      parameter: "arg",
    },
  });
});
