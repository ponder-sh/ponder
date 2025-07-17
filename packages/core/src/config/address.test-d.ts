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

const event1 = parseAbiItem([
  "struct Foo {address arg0;address arg1;address arg2;address arg3;uint256 arg4;}",
  "event CreateMarket(Id indexed id, Foo args)",
]);

test("factory", () => {
  factory({
    address: "0xa",
    event: event1,
    parameter: "args.arg2",
  });
});
