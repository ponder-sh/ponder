import { type AbiEvent, parseAbiItem } from "abitype";
import { test } from "vitest";
import { factory } from "./address.js";

const event0 = parseAbiItem(
  "event Event0(bytes32 indexed arg, bytes32 indexed arg1)",
);
const func = parseAbiItem("function func()");

test("factory with invalid event", () => {
  factory({
    // ^?
    address: "0x",
    // @ts-expect-error
    event: func,
    parameter: "arg",
  });
});

test("factory with weak event", () => {
  factory({
    // ^?
    address: "0x",
    event: {} as AbiEvent,
    parameter: "arg",
  });
});

test("factory", () => {
  factory({
    //  ^?
    address: "0x",
    event: event0,
    parameter: "arg",
  });
});
