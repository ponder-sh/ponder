import { expectTypeOf, test } from "bun:test";
import type { AbiEvent, AbiFunction, ParseAbiItem } from "abitype";
import type { Abi } from "viem";
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
  expectTypeOf<a>().toExtend<Event0 | Event1 | Event1Overloaded>();
  expectTypeOf<Event0 | Event1 | Event1Overloaded>().toExtend<a>();
});

test("ExtractAbiEvents semi-weak abi", () => {
  type a = ExtractAbiEvents<(Event0 | Event1 | Event1Overloaded | Func0)[]>;
  //   ^?
  expectTypeOf<a>().toExtend<Event0 | Event1 | Event1Overloaded>();
  expectTypeOf<Event0 | Event1 | Event1Overloaded>().toExtend<a>();
});

test("ExtractAbiEvents no events", () => {
  type a = ExtractAbiEvents<readonly [Func0]>;
  //   ^?
  expectTypeOf<a>().toExtend<AbiEvent>();
  expectTypeOf<AbiEvent>().toExtend<a>();
});

test("ExtractAbiFunctions", () => {
  type a = ExtractAbiFunctions<
    // ^?
    readonly [Func0, Func1, Func1Overloaded, Event0]
  >;
  expectTypeOf<a>().toExtend<Func0 | Func1 | Func1Overloaded>();
  expectTypeOf<Func0 | Func1 | Func1Overloaded>().toExtend<a>();
});

test("ExtractAbiFunctions semi-weak abi", () => {
  type a = ExtractAbiFunctions<(Func0 | Func1 | Func1Overloaded | Event0)[]>;
  //   ^?
  expectTypeOf<a>().toExtend<Func0 | Func1 | Func1Overloaded>();
  expectTypeOf<Func0 | Func1 | Func1Overloaded>().toExtend<a>();
});

test("ExtractAbiFunctions no events", () => {
  type a = ExtractAbiFunctions<readonly [Event0]>;
  //   ^?
  expectTypeOf<a>().toExtend<AbiFunction>();
  expectTypeOf<AbiFunction>().toExtend<a>();
});

test("ParseAbiEvent no overloaded events ", () => {
  type a = ParseAbiEvent<
    // ^?
    readonly [Event0, Event1],
    "Event0"
  >;

  expectTypeOf<a>().toExtend<Event0>();
  expectTypeOf<Event0>().toExtend<a>();
});

test("ParseAbiEvent overloaded events", () => {
  type a = ParseAbiEvent<
    // ^?
    readonly [Event1, Event1Overloaded],
    "Event1(bytes32 indexed)"
  >;

  expectTypeOf<a>().toExtend<Event1Overloaded>();
  expectTypeOf<Event1Overloaded>().toExtend<a>();
});

test("ParseAbiEvent with semi-weak abi", () => {
  type a = ParseAbiEvent<
    // ^?
    (Event0 | Event1)[],
    "Event0"
  >;

  expectTypeOf<a>().toExtend<Event0>();
  expectTypeOf<Event0>().toExtend<a>();
});

test("ParseAbiEvent with weak abi", () => {
  type a = ParseAbiEvent<
    // ^?
    Abi,
    "Event0"
  >;

  expectTypeOf<a>().toExtend<AbiEvent>();
  expectTypeOf<AbiEvent>().toExtend<a>();
});

test("ParseAbiEvent no matching events", () => {
  type a = ParseAbiEvent<
    // ^?
    readonly [Event0, Event1],
    "Event2"
  >;

  expectTypeOf<a>().toExtend<AbiEvent>();
  expectTypeOf<AbiEvent>().toExtend<a>();
});

test("ParseAbiFunction no overloaded events ", () => {
  type a = ParseAbiFunction<
    // ^?
    readonly [Func0, Func1],
    "func0()"
  >;

  expectTypeOf<a>().toExtend<Func0>();
  expectTypeOf<Func0>().toExtend<a>();
});

test("ParseAbiFunction overloaded events", () => {
  type a = ParseAbiFunction<
    // ^?
    readonly [Func1, Func1Overloaded],
    "func1()"
  >;

  expectTypeOf<a>().toExtend<Func1>();
  expectTypeOf<Func1>().toExtend<a>();
});

test("ParseAbiFunction with semi-weak abi", () => {
  type a = ParseAbiFunction<
    // ^?
    (Func0 | Func1)[],
    "func0()"
  >;

  expectTypeOf<a>().toExtend<Func0>();
  expectTypeOf<Func0>().toExtend<a>();
});

test("ParseAbiFunction with weak abi", () => {
  type a = ParseAbiFunction<
    // ^?
    Abi,
    "func0()"
  >;

  expectTypeOf<a>().toExtend<AbiFunction>();
  expectTypeOf<AbiFunction>().toExtend<a>();
});

test("ParseAbiFunction no matching events", () => {
  type a = ParseAbiFunction<
    // ^?
    readonly [Func0, Func1],
    "func2()"
  >;

  expectTypeOf<a>().toExtend<AbiFunction>();
  expectTypeOf<AbiFunction>().toExtend<a>();
});

test("FormatAbiEvent no overloaded events", () => {
  type a = FormatAbiEvent<readonly [Event0, Event1], Event0>;
  //   ^?

  expectTypeOf<a>().toExtend<"Event0">();
  expectTypeOf<"Event0">().toExtend<a>();
});

test("FormatAbiEvent overloaded events", () => {
  type a = FormatAbiEvent<
    // ^?
    readonly [Event1, Event1Overloaded],
    Event1Overloaded
  >;

  expectTypeOf<a>().toExtend<"Event1(bytes32 indexed)">();
  expectTypeOf({} as unknown as "Event1(bytes32 indexed)").toExtend<a>();
});

test("FormatAbiEvent with semi-weak abi", () => {
  type a = FormatAbiEvent<readonly (Event0 | Event1)[], Event0>;
  //   ^?

  expectTypeOf<a>().toExtend<"Event0">();
  expectTypeOf<"Event0">().toExtend<a>();
});

test("FormatAbiEvent with weak abi", () => {
  type a = FormatAbiEvent<Abi, Event0>;
  //   ^?

  expectTypeOf<a>().toExtend<"Event0">();
  expectTypeOf<"Event0">().toExtend<a>();
});

test("FormatAbiEvent with no matching events", () => {
  type a = FormatAbiEvent<
    // ^?
    readonly [Event1, Event1Overloaded],
    Event0
  >;

  expectTypeOf<a>().toExtend<never>();
  expectTypeOf<never>().toExtend<a>();
});

test("FormatAbiFunction no overloaded events", () => {
  type a = FormatAbiFunction<readonly [Func0, Func1], Func0>;
  //   ^?

  expectTypeOf<a>().toExtend<"func0()">();
  expectTypeOf({} as unknown as "func0()").toExtend<a>();
});

test("FormatAbiFunction overloaded events", () => {
  type a = FormatAbiFunction<
    // ^?
    readonly [Func1, Func1Overloaded],
    Func1Overloaded
  >;

  expectTypeOf<a>().toExtend<"func1(bytes32)">();
  expectTypeOf({} as unknown as "func1(bytes32)").toExtend<a>();
});

test("FormatAbiFunction with semi-weak abi", () => {
  type a = FormatAbiFunction<readonly (Func0 | Func1)[], Func0>;
  //   ^?

  expectTypeOf<a>().toExtend<"func0()">();
  expectTypeOf({} as unknown as "func0()").toExtend<a>();
});

test("FormatAbiFunction with weak abi", () => {
  type a = FormatAbiFunction<Abi, Func0>;
  //   ^?

  expectTypeOf<a>().toExtend<"func0()">();
  expectTypeOf({} as unknown as "func0()").toExtend<a>();
});

test("FormatAbiFunction with no matching events", () => {
  type a = FormatAbiFunction<
    // ^?
    readonly [Func1, Func1Overloaded],
    Func0
  >;

  expectTypeOf<a>().toExtend<never>();
  expectTypeOf<never>().toExtend<a>();
});

test("SafeEventNames no overloaded events", () => {
  type a = SafeEventNames<
    // ^?
    readonly [Event0, Event1, Func0]
  >;
  expectTypeOf<a>().toExtend<"Event0" | "Event1">();
  expectTypeOf<"Event0" | "Event1">().toExtend<a>();
});

test("SafeEventNames overloaded events", () => {
  type a = SafeEventNames<
    // ^?
    readonly [Event0, Event1, Event1Overloaded, Func0]
  >;
  expectTypeOf<a>().toExtend<
    "Event0" | "Event1()" | "Event1(bytes32 indexed)"
  >();
  expectTypeOf(
    {} as unknown as "Event0" | "Event1()" | "Event1(bytes32 indexed)",
  ).toExtend<a>();
});

test("SafeEventNames semi-weak abi", () => {
  type a = SafeEventNames<
    // ^?
    (Event0 | Event1 | Func0)[]
  >;
  expectTypeOf<a>().toExtend<"Event0" | "Event1">();
  expectTypeOf<"Event0" | "Event1">().toExtend<a>();
});

test("SafeEventNames weak abi", () => {
  type a = SafeEventNames<Abi>;
  //   ^?
  expectTypeOf<a>().toExtend<string>();
  expectTypeOf<string>().toExtend<a>();
});

test("SafeFunctionNames no overloaded events", () => {
  type a = SafeFunctionNames<
    // ^?
    readonly [Func0, Func1, Event0]
  >;
  expectTypeOf<a>().toExtend<"func0()" | "func1()">();
  expectTypeOf({} as unknown as "func0()" | "func1()").toExtend<a>();
});

test("SafeFunctionNames overloaded events", () => {
  type a = SafeFunctionNames<
    // ^?
    readonly [Func0, Func1, Func1Overloaded, Event0]
  >;
  expectTypeOf<a>().toExtend<"func0()" | "func1()" | "func1(bytes32)">();
  expectTypeOf(
    {} as unknown as "func0()" | "func1()" | "func1(bytes32)",
  ).toExtend<a>();
});

test("SafeFunctionNames semi-weak abi", () => {
  type a = SafeFunctionNames<
    // ^?
    (Func0 | Func1 | Event0)[]
  >;
  expectTypeOf<a>().toExtend<"func0()" | "func1()">();
  expectTypeOf({} as unknown as "func0()" | "func1()").toExtend<a>();
});

test("SafeFunctionNames weak abi", () => {
  type a = SafeFunctionNames<Abi>;
  //   ^?
  expectTypeOf<a>().toExtend<`${string}()`>();
  expectTypeOf({} as unknown as `${string}()`).toExtend<a>();
});
