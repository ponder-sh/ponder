import { ParseAbi } from "abitype";
import { assertType, test } from "vitest";

import { PonderApp } from "./ponderApp";

type OneAbi = ParseAbi<
  ["event Event0(bytes32 indexed arg3)", "event Event1(bytes32 indexed)"]
>;
type TwoAbi = ParseAbi<["event Event(bytes32 indexed)", "event Event()"]>;

test("PonderApp non intersecting event names", () => {
  type p = PonderApp<{
    // ^?
    networks: any;
    contracts: readonly [{ name: "One"; network: any; abi: OneAbi }];
  }>;

  type name = Parameters<p["on"]>[0];
  //   ^?

  assertType<name>("" as "One:Event0" | "One:Event1");
});

test("PonderApp intersecting event names", () => {
  type p = PonderApp<{
    // ^?
    networks: any;
    contracts: readonly [{ name: "Two"; network: any; abi: TwoAbi }];
  }>;

  type name = Parameters<p["on"]>[0];
  //   ^?

  assertType<name>("" as "Two:Event(bytes32 indexed)" | "Two:Event()");
});

test("PonderApp multiple contracts", () => {
  type p = PonderApp<{
    // ^?
    networks: any;
    contracts: readonly [
      { name: "One"; network: any; abi: OneAbi },
      { name: "Two"; network: any; abi: TwoAbi }
    ];
  }>;

  // Events should only correspond to their contract
  type name = Exclude<
    //   ^?
    Parameters<p["on"]>[0],
    "One:Event0" | "One:Event1" | "Two:Event(bytes32 indexed)" | "Two:Event()"
  >;

  assertType<never>("" as name);
});

test("PonderApp event type"),
  () => {
    type p = PonderApp<{
      // ^?
      networks: any;
      contracts: readonly [{ name: "One"; network: any; abi: OneAbi }];
    }>;

    type name = Parameters<Parameters<p["on"]>[1]>[0]["event"]["name"];
    //   ^?

    assertType<name>("" as "Event0" | "Event1");

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (({}) as p).on("One:Event1", ({ event }) => {});
    //                              ^?
  };
