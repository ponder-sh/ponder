import type { Abi } from "abitype";
import type { ParseAbiItem } from "viem";
import { assertType, test } from "vitest";
import type { DefaultEventFilter, EventFilter } from "./eventFilter.js";

type Event0 = ParseAbiItem<"event Event0(bytes32 indexed arg)">;

test("EventFilter with strict event", () => {
  type t = EventFilter<readonly [Event0], "Event0">;
  //   ^?

  assertType<{ event: "Event0" }>({} as unknown as t);
});

test("EventFilter with strict event array", () => {
  type t = EventFilter<readonly [Event0], readonly ["Event0"]>;
  //   ^?
  assertType<{ event: readonly ["Event0"]; args?: never }>({} as unknown as t);
});

test("EventFilter with weak abi 1", () => {
  type t = EventFilter<Abi>;
  //   ^?
  assertType<DefaultEventFilter>({} as unknown as t);
});

test("EventFilter with weak abi 2", () => {
  type t = EventFilter<readonly unknown[]>;
  //   ^?
  assertType<DefaultEventFilter>({} as unknown as t);
});
