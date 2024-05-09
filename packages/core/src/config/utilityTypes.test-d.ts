import type { AbiEvent, AbiFunction, ParseAbiItem } from "abitype";
import { type Abi } from "viem";
import { assertType, test } from "vitest";
import type {
  ExtractAbiEvents,
  ExtractAbiFunctions,
  FormatAbiEvent,
  FormatAbiFunction,
  ParseAbiEvent,
  ParseAbiFunction,
  SafeEventNames,
  SafeFunctionNames,
} from "./utilityTypes.js";

type Event0 = ParseAbiItem<"event Event0(bytes32 indexed arg)">;
type Event1 = ParseAbiItem<"event Event1()">;
type Event1Overloaded = ParseAbiItem<"event Event1(bytes32 indexed)">;
type Func0 = ParseAbiItem<"function func0(address) external returns (uint256)">;
type Func1 = ParseAbiItem<"function func1()">;
type Func1Overloaded = ParseAbiItem<"function func1(bytes32)">;

test("ExtractAbiEvents", () => {
  type a = ExtractAbiEvents<readonly [Event0, Event1, Event1Overloaded, Func0]>;
  //   ^?
  assertType<Event0 | Event1 | Event1Overloaded>({} as unknown as a);
  assertType<a>({} as unknown as Event0 | Event1 | Event1Overloaded);
});

test("ExtractAbiEvents semi-weak abi", () => {
  type a = ExtractAbiEvents<(Event0 | Event1 | Event1Overloaded | Func0)[]>;
  //   ^?
  assertType<Event0 | Event1 | Event1Overloaded>({} as unknown as a);
  assertType<a>({} as unknown as Event0 | Event1 | Event1Overloaded);
});

test("ExtractAbiEvents no events", () => {
  type a = ExtractAbiEvents<readonly [Func0]>;
  //   ^?
  assertType<AbiEvent>({} as unknown as a);
  assertType<a>({} as unknown as AbiEvent);
});

test("ExtractAbiFunctions", () => {
  type a = ExtractAbiFunctions<
    // ^?
    readonly [Func0, Func1, Func1Overloaded, Event0]
  >;
  assertType<Func0 | Func1 | Func1Overloaded>({} as unknown as a);
  assertType<a>({} as unknown as Func0 | Func1 | Func1Overloaded);
});

test("ExtractAbiFunctions semi-weak abi", () => {
  type a = ExtractAbiFunctions<(Func0 | Func1 | Func1Overloaded | Event0)[]>;
  //   ^?
  assertType<Func0 | Func1 | Func1Overloaded>({} as unknown as a);
  assertType<a>({} as unknown as Func0 | Func1 | Func1Overloaded);
});

test("ExtractAbiFunctions no events", () => {
  type a = ExtractAbiFunctions<readonly [Event0]>;
  //   ^?
  assertType<AbiFunction>({} as unknown as a);
  assertType<a>({} as unknown as AbiFunction);
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

test("ParseAbiFunction no overloaded events ", () => {
  type a = ParseAbiFunction<
    // ^?
    readonly [Func0, Func1],
    "func0()"
  >;

  assertType<Func0>({} as unknown as a);
  assertType<a>({} as unknown as Func0);
});

test("ParseAbiFunction overloaded events", () => {
  type a = ParseAbiFunction<
    // ^?
    readonly [Func1, Func1Overloaded],
    "func1()"
  >;

  assertType<Func1>({} as unknown as a);
  assertType<a>({} as unknown as Func1);
});

test("ParseAbiFunction with semi-weak abi", () => {
  type a = ParseAbiFunction<
    // ^?
    (Func0 | Func1)[],
    "func0()"
  >;

  assertType<Func0>({} as unknown as a);
  assertType<a>({} as unknown as Func0);
});

test("ParseAbiFunction with weak abi", () => {
  type a = ParseAbiFunction<
    // ^?
    Abi,
    "func0()"
  >;

  assertType<AbiFunction>({} as unknown as a);
  assertType<a>({} as unknown as AbiFunction);
});

test("ParseAbiFunction no matching events", () => {
  type a = ParseAbiFunction<
    // ^?
    readonly [Func0, Func1],
    "func2()"
  >;

  assertType<AbiFunction>({} as unknown as a);
  assertType<a>({} as unknown as AbiFunction);
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
  type a = FormatAbiEvent<Abi, Event0>;
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

test("FormatAbiFunction no overloaded events", () => {
  type a = FormatAbiFunction<readonly [Func0, Func1], Func0>;
  //   ^?

  assertType<"func0()">({} as unknown as a);
  assertType<a>({} as unknown as "func0()");
});

test("FormatAbiFunction overloaded events", () => {
  type a = FormatAbiFunction<
    // ^?
    readonly [Func1, Func1Overloaded],
    Func1Overloaded
  >;

  assertType<"func1(bytes32)">({} as unknown as a);
  assertType<a>({} as unknown as "func1(bytes32)");
});

test("FormatAbiFunction with semi-weak abi", () => {
  type a = FormatAbiFunction<readonly (Func0 | Func1)[], Func0>;
  //   ^?

  assertType<"func0()">({} as unknown as a);
  assertType<a>({} as unknown as "func0()");
});

test("FormatAbiFunction with weak abi", () => {
  type a = FormatAbiFunction<Abi, Func0>;
  //   ^?

  assertType<"func0()">({} as unknown as a);
  assertType<a>({} as unknown as "func0()");
});

test("FormatAbiFunction with no matching events", () => {
  type a = FormatAbiFunction<
    // ^?
    readonly [Func1, Func1Overloaded],
    Func0
  >;

  assertType<never>({} as unknown as a);
  assertType<a>({} as unknown as never);
});

test("SafeEventNames no overloaded events", () => {
  type a = SafeEventNames<
    // ^?
    readonly [Event0, Event1, Func0]
  >;
  assertType<"Event0" | "Event1">({} as unknown as a);
  assertType<a>({} as unknown as "Event0" | "Event1");
});

test("SafeEventNames overloaded events", () => {
  type a = SafeEventNames<
    // ^?
    readonly [Event0, Event1, Event1Overloaded, Func0]
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
    (Event0 | Event1 | Func0)[]
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

test("SafeFunctionNames no overloaded events", () => {
  type a = SafeFunctionNames<
    // ^?
    readonly [Func0, Func1, Event0]
  >;
  assertType<"func0()" | "func1()">({} as unknown as a);
  assertType<a>({} as unknown as "func0()" | "func1()");
});

test("SafeFunctionNames overloaded events", () => {
  type a = SafeFunctionNames<
    // ^?
    readonly [Func0, Func1, Func1Overloaded, Event0]
  >;
  assertType<"func0()" | "func1()" | "func1(bytes32)">({} as unknown as a);
  assertType<a>({} as unknown as "func0()" | "func1()" | "func1(bytes32)");
});

test("SafeFunctionNames semi-weak abi", () => {
  type a = SafeFunctionNames<
    // ^?
    (Func0 | Func1 | Event0)[]
  >;
  assertType<"func0()" | "func1()">({} as unknown as a);
  assertType<a>({} as unknown as "func0()" | "func1()");
});

test("SafeFunctionNames weak abi", () => {
  type a = SafeFunctionNames<Abi>;
  //   ^?
  assertType<`${string}()`>({} as unknown as a);
  assertType<a>({} as unknown as `${string}()`);
});
