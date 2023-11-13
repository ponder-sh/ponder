import type { ParseAbi, ParseAbiItem } from "viem";
import { http } from "viem";
import { assertType, test } from "vitest";

import type {
  Config,
  FilterAbiEvents,
  RecoverAbiEvent,
  SafeEventNames,
} from "./config.js";
import { createConfig } from "./config.js";

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

type OneAbi = ParseAbi<
  [
    "event Event0(bytes32 indexed arg3)",
    "event Event1(bytes32 indexed)",
    "constructor()",
  ]
>;
type TwoAbi = ParseAbi<["event Event(bytes32 indexed)", "event Event()"]>;

test("filter events", () => {
  type t = FilterAbiEvents<OneAbi>;
  //   ^?

  assertType<t>(
    [] as unknown as ParseAbi<
      ["event Event0(bytes32 indexed arg3)", "event Event1(bytes32 indexed)"]
    >,
  );
});

test("safe event names", () => {
  type a = SafeEventNames<
    // ^?
    FilterAbiEvents<OneAbi>
  >;
  assertType<a>(["Event0", "Event1"] as const);

  type b = SafeEventNames<
    // ^?
    FilterAbiEvents<TwoAbi>
  >;
  assertType<b>(["Event(bytes32 indexed)", "Event()"] as const);
});

test("ResolvedConfig default values", () => {
  type a = NonNullable<
    // ^?
    Config["contracts"]
  >[number]["network"][number]["filter"];
  assertType<a>({} as { event: string[] } | { event: string } | undefined);
});

test("RecoverAbiEvent", () => {
  type a = RecoverAbiEvent<
    // ^?
    FilterAbiEvents<OneAbi>,
    "Event1"
  >;

  assertType<a>({} as ParseAbiItem<"event Event1(bytes32 indexed)">);
});

test("createConfig() strict config names", () => {
  const config = createConfig({
    networks: [
      { name: "mainnet", chainId: 1, transport: http("http://127.0.0.1:8545") },
    ],
    contracts: [
      {
        name: "BaseRegistrarImplementation",
        network: [{ name: "mainnet" }],
        abi: [],
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    ],
  });

  assertType<readonly [{ name: "mainnet" }]>(config.contracts[0].network);
  assertType<readonly [{ name: "mainnet" }]>(config.networks);
});

test("createConfig() has strict events inferred from abi", () => {
  createConfig({
    networks: [
      { name: "mainnet", chainId: 1, transport: http("http://127.0.0.1:8545") },
    ],
    contracts: [
      {
        name: "BaseRegistrarImplementation",
        network: [{ name: "mainnet" }],
        abi: abiWithSameEvent,
        filter: {
          event: [
            "Transfer",
            "Approve(address indexed from, address indexed to, uint256 amount)",
          ],
        },
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    ],
  });
});

test("createConfig() has strict arg types for event", () => {
  createConfig({
    networks: [
      { name: "mainnet", chainId: 1, transport: http("http://127.0.0.1:8545") },
    ],
    contracts: [
      {
        name: "BaseRegistrarImplementation",
        network: [
          {
            name: "mainnet",
          },
        ],
        abi: abiSimple,
        filter: {
          event: "Approve",
          args: { to: ["0x2"] },
        },
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    ],
  });
});
