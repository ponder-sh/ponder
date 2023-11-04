import { assertType, test } from "vitest";

import {
  FilterEvents,
  RecoverAbiEvent,
  ResolvedConfig,
  SafeEventNames,
} from "./config";

export const abiSimple = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [
      {
        indexed: true,
        type: "address",
        name: "from",
      },
      {
        indexed: true,
        type: "address",
        name: "to",
      },
      {
        indexed: false,
        type: "uint256",
        name: "amount",
      },
    ],
    name: "Approve",
    type: "event",
  },
  {
    inputs: [
      {
        indexed: true,
        type: "address",
      },
      {
        indexed: true,
        type: "address",
      },
      {
        indexed: false,
        type: "uint256",
      },
    ],
    name: "Transfer",
    type: "event",
  },
] as const;

export const abiWithSameEvent = [
  ...abiSimple,
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [
      {
        indexed: true,
        type: "address",
      },
      {
        indexed: true,
        type: "bytes32",
      },
      {
        indexed: false,
        type: "uint256",
      },
    ],
    name: "Approve",
    type: "event",
  },
] as const;

test("filter events", () => {
  type t = FilterEvents<typeof abiWithSameEvent>;
  //   ^?

  assertType<t>([
    abiWithSameEvent[1],
    abiWithSameEvent[2],
    abiWithSameEvent[4],
  ] as const);
});

test("safe event names", () => {
  type a = SafeEventNames<
    // ^?
    FilterEvents<typeof abiSimple>,
    FilterEvents<typeof abiSimple>
  >;
  assertType<a>(["Approve", "Transfer"] as const);

  type b = SafeEventNames<
    // ^?
    FilterEvents<typeof abiWithSameEvent>,
    FilterEvents<typeof abiWithSameEvent>
  >;
  assertType<b>([
    "Approve(address indexed from, address indexed to, uint256 amount)",
    "Transfer",
    "Approve(address indexed, bytes32 indexed, uint256)",
  ]);
});

test("ResolvedConfig default values", () => {
  type a = NonNullable<ResolvedConfig["contracts"]>[number]["filter"];
  //   ^?
  assertType<a>({} as string[] | { event: string } | undefined);
});

test("RecoverAbiEvent", () => {
  type a = RecoverAbiEvent<
    // ^?
    FilterEvents<typeof abiSimple>,
    SafeEventNames<
      FilterEvents<typeof abiSimple>,
      FilterEvents<typeof abiSimple>
    >,
    "Approve"
  >;

  assertType<a>(abiSimple[1]);
});
