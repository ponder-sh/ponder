import { http } from "viem";
import { assertType, test } from "vitest";

import {
  Config,
  createConfig,
  FilterAbiEvents,
  RecoverAbiEvent,
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
  type t = FilterAbiEvents<typeof abiWithSameEvent>;
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
    FilterAbiEvents<typeof abiSimple>
  >;
  assertType<a>(["Approve", "Transfer"] as const);

  type b = SafeEventNames<
    // ^?
    FilterAbiEvents<typeof abiWithSameEvent>
  >;
  assertType<b>([
    "Approve(address indexed from, address indexed to, uint256 amount)",
    "Transfer",
    "Approve(address indexed, bytes32 indexed, uint256)",
  ]);
});

test("ResolvedConfig default values", () => {
  type a = NonNullable<Config["contracts"]>[number]["filter"];
  //   ^?
  assertType<a>({} as { event: string[] } | { event: string } | undefined);
});

test("RecoverAbiEvent", () => {
  type a = RecoverAbiEvent<
    // ^?
    FilterAbiEvents<typeof abiSimple>,
    "Approve"
  >;

  assertType<a>(abiSimple[1]);
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
  const config = createConfig({
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
  assertType<
    readonly [
      "Transfer",
      "Approve(address indexed from, address indexed to, uint256 amount)"
    ]
  >(config.contracts[0].filter.event);
});

test("createConfig() has strict arg types for event", () => {
  const config = createConfig({
    networks: [
      { name: "mainnet", chainId: 1, transport: http("http://127.0.0.1:8545") },
    ],
    contracts: [
      {
        name: "BaseRegistrarImplementation",
        network: [
          {
            name: "mainnet",
            address: "0x",
            filter: { event: "Approve", args: { from: "0x", to: "0x" } },
          },
        ],
        abi: abiSimple,
        filter: {
          event: "Approve",
          args: {
            to: ["0x1", "0x2"],
          },
        },
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    ],
  });

  assertType<
    { to?: `0x${string}` | `0x${string}`[] | null | undefined } | undefined
  >(config.contracts[0].filter?.args);
});
