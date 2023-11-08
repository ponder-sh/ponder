import { AbiEvent, ParseAbi } from "abitype";
import { assertType, test } from "vitest";

import { ExtractAddress, ExtractAllAddresses, PonderApp } from "./ponderApp";

type OneAbi = ParseAbi<
  ["event Event0(bytes32 indexed arg3)", "event Event1(bytes32 indexed)"]
>;
type TwoAbi = ParseAbi<["event Event(bytes32 indexed)", "event Event()"]>;

test("ExtractAddress", () => {
  type a = ExtractAddress<{ address: "0x2" }>;
  //   ^?
  assertType<a>("" as "0x2");

  type b = ExtractAddress<{
    // ^?
    factory: { address: "0x2"; event: AbiEvent; parameter: string };
  }>;
  assertType<b>("" as never);
});

test("ExtractAllAddress", () => {
  type a = ExtractAllAddresses<
    // ^?
    [
      { name: "optimism"; address: "0x2" },
      {
        name: "optimism";
        factory: { address: "0x2"; event: AbiEvent; parameter: string };
      }
    ]
  >[never];
  //   ^?
  assertType<a>("" as "0x2");
});

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

test("PonderApp context network type", () => {
  type p = PonderApp<{
    // ^?
    networks: any;
    contracts: readonly [
      {
        name: "One";
        network: [{ name: "mainnet" }, { name: "optimism" }];
        abi: OneAbi;
      }
    ];
  }>;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (({}) as p).on("One:Event1", ({ context }) => {});
  //                              ^?
});

test("PonderApp context client type", () => {
  type p = PonderApp<{
    // ^?
    networks: any;
    contracts: readonly [
      {
        name: "One";
        network: [{ name: "mainnet" }, { name: "optimism" }];
        abi: OneAbi;
      }
    ];
  }>;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (({}) as p).on("One:Event1", ({ context: { client } }) => {});
  //                                         ^?
});

test("PonderApp context contracts type", () => {
  type p = PonderApp<{
    // ^?
    networks: any;
    contracts: readonly [
      {
        name: "One";
        network: [{ name: "mainnet"; address: "0x1" }, { name: "optimism" }];
        abi: OneAbi;
        address: "0x2";
        startBlock: 1;
        endBlock: 2;
      }
    ];
  }>;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (({}) as p).on("One:Event1", ({ context: { contracts } }) => {});
  //                                         ^?
});
