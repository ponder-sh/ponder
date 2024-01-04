import type { ParseAbiItem } from "abitype";
import { assertType, test } from "vitest";
import type { FilterAbiEvents, SafeEventNames } from "./utilityTypes.js";

type Event0 = ParseAbiItem<"event Event0(bytes32 indexed arg)">;
type Event1 = ParseAbiItem<"event Event1()">;
type Event1Overloaded = ParseAbiItem<"event Event1(bytes32 indexed)">;
type Func = ParseAbiItem<"function func()">;

test("FilterAbiEvents", () => {
  type t = FilterAbiEvents<readonly [Event0, Func]>;
  //   ^?

  assertType<readonly [Event0]>({} as unknown as t);
});

test("SafeEventNames", () => {
  type a = SafeEventNames<
    // ^?
    readonly [Event0, Event1]
  >;
  assertType<"Event0" | "Event1">({} as unknown as a);
});

test("SafeEventNames overloaded", () => {
  type a = SafeEventNames<
    // ^?
    readonly [Event1, Event1Overloaded]
  >;
  assertType<"Event1()" | "Event1(bytes32 indexed)">({} as unknown as a);
});
