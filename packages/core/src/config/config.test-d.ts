import { assertType, test } from "vitest";

import {
  ContractFilter,
  FilterElement,
  FilterEvents,
  Kevin,
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

test("filter elements", () => {
  type a = FilterElement<"a", readonly ["a", "b", "c"]>;
  //   ^?
  assertType<a>(["b", "c"] as const);
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
    "Approve(address indexed, address indexed, uint256)",
    "Transfer",
    "Approve(address indexed, bytes32 indexed, uint256)",
  ]);
});

test("infer event names from abi", () => {
  type a = ContractFilter<typeof abiSimple>["event"];
  //   ^?

  assertType<a>([] as readonly ("Approve" | "Transfer")[] | undefined);
});

test("kevin", () => {
  const a = [
    {
      name: "BaseRegistrarImplementation",
      network: [{ name: "mainnet" }],
      abi: abiSimple,
      event: ["Approve"],
      address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
      startBlock: 16370000,
      endBlock: 16370020,
      maxBlockRange: 10,
    },
  ] as const;
  type t = Kevin<typeof a, "mainnet">[0]["event"];
  //   ^?
});
