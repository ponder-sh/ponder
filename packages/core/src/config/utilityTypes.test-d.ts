import type { AbiEvent, ParseAbiItem } from "abitype";
import { type Abi } from "viem";
import { assertType, test } from "vitest";
import type {
  ExtractAbiEvents,
  FormatAbiEvent,
  ParseAbiEvent,
  SafeEventNames,
} from "./utilityTypes.js";

type Event0 = ParseAbiItem<"event Event0(bytes32 indexed arg)">;
type Event1 = ParseAbiItem<"event Event1()">;
type Event1Overloaded = ParseAbiItem<"event Event1(bytes32 indexed)">;
type Func = ParseAbiItem<"function func()">;

test("ExtractAbiEvents", () => {
  type a = ExtractAbiEvents<readonly [Event0, Event1, Event1Overloaded, Func]>;
  //   ^?
  assertType<Event0 | Event1 | Event1Overloaded>({} as unknown as a);
  assertType<a>({} as unknown as Event0 | Event1 | Event1Overloaded);
});

test("ExtractAbiEvents semi-weak abi", () => {
  type a = ExtractAbiEvents<(Event0 | Event1 | Event1Overloaded | Func)[]>;
  //   ^?
  assertType<Event0 | Event1 | Event1Overloaded>({} as unknown as a);
  assertType<a>({} as unknown as Event0 | Event1 | Event1Overloaded);
});

test("ExtractAbiEvents no events", () => {
  type a = ExtractAbiEvents<readonly [Func]>;
  //   ^?
  assertType<AbiEvent>({} as unknown as a);
  assertType<a>({} as unknown as AbiEvent);
});

test("ParseAbiEvent no overloaded events ", () => {
  type a = ParseAbiEvent<
    // ^?
    readonly [Event0, Event1],
    "Event0"
  >;

  assertType<Event0>({} as unknown as a);
  assertType<a>({} as unknown as Event0);
});

test("ParseAbiEvent overloaded events", () => {
  type a = ParseAbiEvent<
    // ^?
    readonly [Event1, Event1Overloaded],
    "Event1(bytes32 indexed)"
  >;

  assertType<Event1Overloaded>({} as unknown as a);
  assertType<a>({} as unknown as Event1Overloaded);
});

test("ParseAbiEvent with semi-weak abi", () => {
  type a = ParseAbiEvent<
    // ^?
    (Event0 | Event1)[],
    "Event0"
  >;

  assertType<Event0>({} as unknown as a);
  assertType<a>({} as unknown as Event0);
});

test("ParseAbiEvent with weak abi", () => {
  type a = ParseAbiEvent<
    // ^?
    Abi,
    "Event0"
  >;

  assertType<AbiEvent>({} as unknown as a);
  assertType<a>({} as unknown as AbiEvent);
});

test("ParseAbiEvent no matching events", () => {
  type a = ParseAbiEvent<
    // ^?
    readonly [Event0, Event1],
    "Event2"
  >;

  assertType<AbiEvent>({} as unknown as a);
  assertType<a>({} as unknown as AbiEvent);
});

test("FormatAbiEvent no overloaded events", () => {
  type a = FormatAbiEvent<readonly [Event0, Event1], Event0>;
  //   ^?

  assertType<"Event0">({} as unknown as a);
  assertType<a>({} as unknown as "Event0");
});

test("FormatAbiEvent overloaded events", () => {
  type a = FormatAbiEvent<
    // ^?
    readonly [Event1, Event1Overloaded],
    Event1Overloaded
  >;

  assertType<"Event1(bytes32 indexed)">({} as unknown as a);
  assertType<a>({} as unknown as "Event1(bytes32 indexed)");
});

test("FormatAbiEvent with semi-weak abi", () => {
  type a = FormatAbiEvent<readonly (Event0 | Event1)[], Event0>;
  //   ^?

  assertType<"Event0">({} as unknown as a);
  assertType<a>({} as unknown as "Event0");
});

test("FormatAbiEvent with weak abi", () => {
  type a = FormatAbiEvent<readonly [Event0, Event1], Event0>;
  //   ^?

  assertType<"Event0">({} as unknown as a);
  assertType<a>({} as unknown as "Event0");
});

test("FormatAbiEvent with no matching events", () => {
  type a = FormatAbiEvent<
    // ^?
    readonly [Event1, Event1Overloaded],
    Event0
  >;

  assertType<never>({} as unknown as a);
  assertType<a>({} as unknown as never);
});

test("SafeEventNames no overloaded events", () => {
  type a = SafeEventNames<
    // ^?
    readonly [Event0, Event1, Func]
  >;
  assertType<"Event0" | "Event1">({} as unknown as a);
  assertType<a>({} as unknown as "Event0" | "Event1");
});

test("SafeEventNames overloaded events", () => {
  type a = SafeEventNames<
    // ^?
    readonly [Event0, Event1, Event1Overloaded, Func]
  >;
  assertType<"Event0" | "Event1()" | "Event1(bytes32 indexed)">(
    {} as unknown as a,
  );
  assertType<a>(
    {} as unknown as "Event0" | "Event1()" | "Event1(bytes32 indexed)",
  );
});

test("SafeEventNames semi-weak abi", () => {
  type a = SafeEventNames<
    // ^?
    (Event0 | Event1 | Func)[]
  >;
  assertType<"Event0" | "Event1">({} as unknown as a);
  assertType<a>({} as unknown as "Event0" | "Event1");
});

test("SafeEventNames weak abi", () => {
  type a = SafeEventNames<Abi>;
  //   ^?
  assertType<string>({} as unknown as a);
  assertType<a>({} as unknown as string);
});
