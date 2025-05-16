import { setupAnvil, setupCommon } from "@/_test/setup.js";
import { poolId } from "@/_test/utils.js";
import { factory } from "@/config/address.js";
import { createConfig } from "@/config/index.js";
import type { LogFactory, LogFilter, TraceFilter } from "@/internal/types.js";
import { shouldGetTransactionReceipt } from "@/sync/filter.js";
import {
  type Address,
  parseAbiItem,
  toEventSelector,
  toFunctionSelector,
  zeroAddress,
} from "viem";
import { beforeEach, expect, test } from "vitest";
import {
  buildConfigAndIndexingFunctions,
  safeBuildConfigAndIndexingFunctions,
} from "./configAndIndexingFunctions.js";

beforeEach(setupCommon);

const event0 = parseAbiItem("event Event0(bytes32 indexed arg)");
const event1 = parseAbiItem("event Event1()");
const event1Overloaded = parseAbiItem("event Event1(bytes32 indexed)");
const eventFactory = parseAbiItem("event EventFactory(address indexed child)");
const func0 = parseAbiItem(
  "function func0(address) external returns (uint256)",
);

const address1 = "0x0000000000000000000000000000000000000001";
const address2 = "0x0000000000000000000000000000000000000001";
const address3 = "0x0000000000000000000000000000000000000003";
const bytes1 =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
const bytes2 =
  "0x0000000000000000000000000000000000000000000000000000000000000002";

beforeEach(setupAnvil);

test("buildConfigAndIndexingFunctions() builds topics for multiple events", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event0, event1],
        address: address1,
        startBlock: 16370000,
        endBlock: 16370020,
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [
      { name: "a:Event0", fn: () => {} },
      { name: "a:Event1", fn: () => {} },
    ],
  });

  expect((sources[0]!.filter as LogFilter).topic0).toMatchObject([
    toEventSelector(event0),
    toEventSelector(event1),
  ]);
});

test("buildConfigAndIndexingFunctions() handles overloaded event signatures and combines topics", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event1, event1Overloaded],
        address: address1,
        startBlock: 16370000,
        endBlock: 16370020,
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [
      { name: "a:Event1()", fn: () => {} },
      { name: "a:Event1(bytes32 indexed)", fn: () => {} },
    ],
  });

  expect((sources[0]!.filter as LogFilter).topic0).toMatchObject([
    toEventSelector(event1),
    toEventSelector(event1Overloaded),
  ]);
});

test("buildConfigAndIndexingFunctions() handles multiple addresses", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    contracts: {
      a: {
        chain: {
          mainnet: {
            address: [address1, address3],
            startBlock: 16370000,
            endBlock: 16370020,
          },
        },
        abi: [event1, event1Overloaded],
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [
      { name: "a:Event1()", fn: () => {} },
      { name: "a:Event1(bytes32 indexed)", fn: () => {} },
    ],
  });

  expect((sources[0]!.filter as LogFilter).topic0).toMatchObject([
    toEventSelector(event1),
    toEventSelector(event1Overloaded),
  ]);
});

test("buildConfigAndIndexingFunctions() creates a source for each chain for multi-chain contracts", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "http://127.0.0.1:8545" },
      optimism: { id: 10, rpc: "http://127.0.0.1:8545" },
    },
    contracts: {
      a: {
        chain: { mainnet: {}, optimism: {} },
        abi: [event0],
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
  });

  expect(sources.length).toBe(2);
});

test("buildConfigAndIndexingFunctions() builds topics for event filter", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "http://127.0.0.1:8545" },
    },
    contracts: {
      a: {
        chain: { mainnet: {} },
        abi: [event0],
        filter: {
          event: "Event0",
          args: {
            arg: bytes1,
          },
        },
        address: address1,
        startBlock: 16370000,
        endBlock: 16370020,
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
  });

  expect(sources).toHaveLength(1);
  expect((sources[0]!.filter as LogFilter).topic0).toMatchObject(
    toEventSelector(event0),
  );
  expect((sources[0]!.filter as LogFilter).topic1).toMatchObject(bytes1);
});

test("buildConfigAndIndexingFunctions() builds topics for multiple event filters", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "http://127.0.0.1:8545" },
    },
    contracts: {
      a: {
        chain: { mainnet: {} },
        abi: [event0, event1Overloaded],
        filter: [
          {
            event: "Event1",
            args: [[bytes1, bytes2]],
          },
          {
            event: "Event0",
            args: {
              arg: bytes1,
            },
          },
        ],
        address: address1,
        startBlock: 16370000,
        endBlock: 16370020,
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [
      { name: "a:Event0", fn: () => {} },
      { name: "a:Event1", fn: () => {} },
    ],
  });

  expect(sources).toHaveLength(2);
  expect((sources[0]!.filter as LogFilter).topic0).toMatchObject(
    toEventSelector(event1Overloaded),
  );
  expect((sources[0]!.filter as LogFilter).topic1).toMatchObject([
    bytes1,
    bytes2,
  ]);
  expect((sources[1]!.filter as LogFilter).topic0).toMatchObject(
    toEventSelector(event0),
  );
  expect((sources[1]!.filter as LogFilter).topic1).toMatchObject(bytes1);
});

test("buildConfigAndIndexingFunctions() overrides default values with chain-specific values", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "http://127.0.0.1:8545" },
    },
    contracts: {
      a: {
        abi: [event0],
        address: address1,
        startBlock: 16370000,
        endBlock: 16370020,
        chain: {
          mainnet: {
            address: address2,
          },
        },
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
  });

  expect((sources[0]!.filter as LogFilter).address).toBe(address2);
});

test("buildConfigAndIndexingFunctions() handles chain name shortcut", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "http://127.0.0.1:8545" },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event0],
        address: address1,
        startBlock: 16370000,
        endBlock: 16370020,
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
  });

  expect(sources[0]!.chain.name).toBe("mainnet");
});

test("buildConfigAndIndexingFunctions() validates chain name", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "http://127.0.0.1:8545" },
    },
    contracts: {
      a: {
        // @ts-expect-error
        chain: "mainnetz",
        abi: [event0],
        address: address1,
      },
    },
  });

  const result = await safeBuildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Invalid chain for 'a'. Got 'mainnetz', expected one of ['mainnet'].",
  );
});

test("buildConfigAndIndexingFunctions() warns for public RPC URL", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "https://cloudflare-eth.com" },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event0],
        address: address1,
      },
    },
  });

  const result = await safeBuildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
  });

  expect(result.status).toBe("success");
  expect(result.logs!.filter((l) => l.level === "warn")).toMatchObject([
    {
      level: "warn",
      msg: "Chain 'mainnet' is using a public RPC URL (https://cloudflare-eth.com). Most apps require an RPC URL with a higher rate limit.",
    },
  ]);
});

test("buildConfigAndIndexingFunctions() handles chains not found in viem", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1909023431, rpc: "https://cloudflare-eth.com" },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event0],
        address: address1,
      },
    },
  });

  const result = await safeBuildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
  });

  expect(result.status).toBe("success");
});

test("buildConfigAndIndexingFunctions() validates event filter event name must be present in ABI", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "https://cloudflare-eth.com" },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event0],
        // @ts-expect-error
        filter: {
          event: "Event2",
          args: {
            arg: "0x",
          },
        },
      },
    },
  });

  const result = await safeBuildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Invalid filter for contract 'a'. Got event name 'Event2', expected one of ['Event0'].",
  );
});

test("buildConfigAndIndexingFunctions() validates address empty string", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "https://cloudflare-eth.com" },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event0],
        address: "" as Address,
      },
    },
  });

  const result = await safeBuildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Invalid prefix for address ''. Got '', expected '0x'.",
  );
});

test("buildConfigAndIndexingFunctions() validates address prefix", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "https://cloudflare-eth.com" },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event0],

        address: "0b0000000000000000000000000000000000000001" as Address,
      },
    },
  });

  const result = await safeBuildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Invalid prefix for address '0b0000000000000000000000000000000000000001'. Got '0b', expected '0x'.",
  );
});

test("buildConfigAndIndexingFunctions() validates address length", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "https://cloudflare-eth.com" },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event0],
        address: "0x000000000001",
      },
    },
  });

  const result = await safeBuildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Invalid length for address '0x000000000001'. Got 14, expected 42 characters.",
  );
});

test("buildConfigAndIndexingFunctions() coerces NaN startBlock to undefined", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "http://127.0.0.1:8545" },
    },
    contracts: {
      a: {
        chain: { mainnet: {} },
        abi: [event0, event1],
        startBlock: Number.NaN,
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
  });

  expect(sources[0]?.filter.fromBlock).toBe(undefined);
});

test("buildConfigAndIndexingFunctions() coerces `latest` to number", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: `http://127.0.0.1:8545/${poolId}`,
      },
    },
    contracts: {
      a: {
        chain: { mainnet: {} },
        abi: [event0, event1],
        startBlock: "latest",
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
  });

  expect(sources[0]?.filter.fromBlock).toBeTypeOf("number");
});

test("buildConfigAndIndexingFunctions() includeTransactionReceipts", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "http://127.0.0.1:8545" },
      optimism: { id: 10, rpc: "http://127.0.0.1:8545" },
    },
    contracts: {
      a: {
        includeTransactionReceipts: true,
        chain: {
          mainnet: {},
          optimism: { includeTransactionReceipts: false },
        },
        abi: [event0],
      },
    },
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
  });

  expect(shouldGetTransactionReceipt(sources[0]!.filter)).toBe(true);
  expect(shouldGetTransactionReceipt(sources[1]!.filter)).toBe(false);
});

test("buildConfigAndIndexingFunctions() includeCallTraces", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "http://127.0.0.1:8545" },
      optimism: { id: 10, rpc: "http://127.0.0.1:8545" },
    },
    contracts: {
      a: {
        includeCallTraces: true,
        chain: {
          mainnet: {},
          optimism: { includeCallTraces: false },
        },
        address: zeroAddress,
        abi: [func0],
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a.func0()", fn: () => {} }],
  });

  expect(sources).toHaveLength(1);

  expect((sources[0]!.filter as TraceFilter).fromAddress).toBeUndefined();
  expect((sources[0]!.filter as TraceFilter).toAddress).toMatchObject([
    zeroAddress,
  ]);
  expect((sources[0]!.filter as TraceFilter).functionSelector).toMatchObject([
    toFunctionSelector(func0),
  ]);
  expect(shouldGetTransactionReceipt(sources[0]!.filter)).toBe(false);
});

test("buildConfigAndIndexingFunctions() includeCallTraces with factory", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "http://127.0.0.1:8545" },
      optimism: { id: 10, rpc: "http://127.0.0.1:8545" },
    },
    contracts: {
      a: {
        includeCallTraces: true,
        chain: {
          mainnet: {},
          optimism: { includeCallTraces: false },
        },
        address: factory({
          address: address2,
          event: eventFactory,
          parameter: "child",
        }),
        abi: [func0],
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a.func0()", fn: () => {} }],
  });

  expect(sources).toHaveLength(1);

  expect((sources[0]!.filter as TraceFilter).fromAddress).toBeUndefined();
  expect(
    ((sources[0]!.filter as TraceFilter).toAddress as LogFactory).address,
  ).toMatchObject(address2);
  expect((sources[0]!.filter as TraceFilter).functionSelector).toMatchObject([
    toFunctionSelector(func0),
  ]);
  expect(shouldGetTransactionReceipt(sources[0]!.filter)).toBe(false);
});

test("buildConfigAndIndexingFunctions() coerces NaN endBlock to undefined", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "http://127.0.0.1:8545" },
    },
    contracts: {
      a: {
        chain: { mainnet: {} },
        abi: [event0, event1],
        endBlock: Number.NaN,
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
  });

  expect(sources[0]!.filter.toBlock).toBe(undefined);
});

test("buildConfigAndIndexingFunctions() account source", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "http://127.0.0.1:8545" },
    },
    accounts: {
      a: {
        chain: { mainnet: {} },
        address: address1,
        startBlock: 16370000,
        endBlock: 16370020,
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [
      { name: "a:transfer:from", fn: () => {} },
      { name: "a:transaction:to", fn: () => {} },
    ],
  });

  expect(sources).toHaveLength(2);

  expect(sources[0]?.chain.name).toBe("mainnet");
  expect(sources[1]?.chain.name).toBe("mainnet");

  expect(sources[0]?.name).toBe("a");
  expect(sources[1]?.name).toBe("a");

  expect(sources[0]?.filter.type).toBe("transaction");
  expect(sources[1]?.filter.type).toBe("transfer");

  expect(sources[0]?.filter.fromBlock).toBe(16370000);
  expect(sources[1]?.filter.fromBlock).toBe(16370000);

  expect(sources[0]?.filter.toBlock).toBe(16370020);
  expect(sources[1]?.filter.toBlock).toBe(16370020);
});

test("buildConfigAndIndexingFunctions() block source", async (context) => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "http://127.0.0.1:8545" },
    },
    blocks: {
      a: {
        chain: { mainnet: {} },
        startBlock: 16370000,
        endBlock: 16370020,
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions: [{ name: "a:block", fn: () => {} }],
  });

  expect(sources).toHaveLength(1);

  expect(sources[0]?.chain.name).toBe("mainnet");
  expect(sources[0]?.name).toBe("a");
  expect(sources[0]?.filter.type).toBe("block");
  // @ts-ignore
  expect(sources[0]?.filter.interval).toBe(1);
  expect(sources[0]?.filter.fromBlock).toBe(16370000);
  expect(sources[0]?.filter.toBlock).toBe(16370020);
});
