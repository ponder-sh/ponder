import { context, setupAnvil, setupCommon } from "@/_test/setup.js";
import { poolId } from "@/_test/utils.js";
import { factory } from "@/config/address.js";
import { createConfig } from "@/config/index.js";
import type { LogFactory, LogFilter, TraceFilter } from "@/internal/types.js";
import { hyperliquidEvm } from "@/utils/chains.js";
import {
  type Address,
  parseAbiItem,
  toEventSelector,
  toFunctionSelector,
  zeroAddress,
} from "viem";
import { beforeEach, expect, test } from "vitest";
import {
  buildConfig,
  buildIndexingFunctions,
  safeBuildConfig,
  safeBuildIndexingFunctions,
} from "./config.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);

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

test("buildIndexingFunctions() builds topics for multiple events", async () => {
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

  const configBuild = buildConfig({
    common: context.common,
    config,
  });

  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [
      { name: "a:Event0", fn: () => {} },
      { name: "a:Event1", fn: () => {} },
    ],
    configBuild,
  });

  expect((eventCallbacks[0]![0]!.filter as LogFilter).topic0).toEqual(
    toEventSelector(event0),
  );
  expect((eventCallbacks[0]![1]!.filter as LogFilter).topic0).toEqual(
    toEventSelector(event1),
  );
});

test("buildIndexingFunctions() handles overloaded event signatures and combines topics", async () => {
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

  const configBuild = buildConfig({
    common: context.common,
    config,
  });
  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [
      { name: "a:Event1()", fn: () => {} },
      { name: "a:Event1(bytes32 indexed)", fn: () => {} },
    ],
    configBuild,
  });

  expect((eventCallbacks[0]![0]!.filter as LogFilter).topic0).toEqual(
    toEventSelector(event1),
  );
  expect((eventCallbacks[0]![1]!.filter as LogFilter).topic0).toEqual(
    toEventSelector(event1Overloaded),
  );
});

test("buildIndexingFunctions() handles multiple addresses", async () => {
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

  const configBuild = buildConfig({
    common: context.common,
    config,
  });
  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [
      { name: "a:Event1()", fn: () => {} },
      { name: "a:Event1(bytes32 indexed)", fn: () => {} },
    ],
    configBuild,
  });

  expect((eventCallbacks[0]![0]!.filter as LogFilter).topic0).toEqual(
    toEventSelector(event1),
  );
  expect((eventCallbacks[0]![1]!.filter as LogFilter).topic0).toEqual(
    toEventSelector(event1Overloaded),
  );
});

test("buildIndexingFunctions() creates a source for each chain for multi-chain contracts", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
      optimism: { id: 10, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    contracts: {
      a: {
        chain: { mainnet: {}, optimism: {} },
        abi: [event0],
      },
    },
  });

  const configBuild = buildConfig({
    common: context.common,
    config,
  });
  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild,
  });

  expect(eventCallbacks.length).toBe(2);
});

test("buildIndexingFunctions() throw useful error for common 0.11 migration mistakes", async () => {
  const indexingFunctions = [{ name: "a:Event0", fn: () => {} }];

  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
      optimism: { id: 10, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    contracts: {
      a: {
        // @ts-expect-error
        network: { mainnet: {}, optimism: {} },
        abi: [event0],
      },
    },
  });

  const configBuild = buildConfig({
    common: context.common,
    // @ts-expect-error
    config,
  });

  const result = await safeBuildIndexingFunctions({
    common: context.common,
    // @ts-expect-error
    config,
    indexingFunctions,
    configBuild,
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Chain for 'a' is null or undefined. Expected one of ['mainnet', 'optimism']. Did you forget to change 'network' to 'chain' when migrating to 0.11?",
  );
});

test("buildIndexingFunctions() builds topics for event filter", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
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

  const configBuild = buildConfig({
    common: context.common,
    config,
  });
  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild,
  });

  expect(eventCallbacks).toHaveLength(1);
  expect((eventCallbacks[0]![0]!.filter as LogFilter).topic0).toEqual(
    toEventSelector(event0),
  );
  expect((eventCallbacks[0]![0]!.filter as LogFilter).topic1).toEqual(bytes1);
});

test("buildIndexingFunctions() builds topics for multiple event filters", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
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

  const configBuild = buildConfig({
    common: context.common,
    config,
  });
  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [
      { name: "a:Event0", fn: () => {} },
      { name: "a:Event1", fn: () => {} },
    ],
    configBuild,
  });

  expect(eventCallbacks[0]).toHaveLength(2);
  expect((eventCallbacks[0]![1]!.filter as LogFilter).topic0).toEqual(
    toEventSelector(event1Overloaded),
  );
  expect((eventCallbacks[0]![1]!.filter as LogFilter).topic1).toEqual([
    bytes1,
    bytes2,
  ]);
  expect((eventCallbacks[0]![0]!.filter as LogFilter).topic0).toEqual(
    toEventSelector(event0),
  );
  expect((eventCallbacks[0]![0]!.filter as LogFilter).topic1).toEqual(bytes1);
});

test("buildIndexingFunctions() overrides default values with chain-specific values", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
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

  const configBuild = buildConfig({
    common: context.common,
    config,
  });
  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild,
  });

  expect((eventCallbacks[0]![0]!.filter as LogFilter).address).toBe(address2);
});

test("buildIndexingFunctions() handles chain name shortcut", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
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

  const configBuild = buildConfig({
    common: context.common,
    config,
  });
  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild,
  });

  expect(eventCallbacks[0]![0]!.chain.name).toBe("mainnet");
});

test("buildIndexingFunctions() validates chain name", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
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

  const configBuild = buildConfig({
    common: context.common,
    config,
  });
  const result = await safeBuildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild,
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Invalid chain for 'a'. Got 'mainnetz', expected one of ['mainnet'].",
  );
});

// Note: Not possible to find an rpc url that returns a finalized block and is public.
test.skip("buildConfig() warns for public RPC URL", () => {
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

  const result = safeBuildConfig({
    common: context.common,
    config,
  });

  expect(result.status).toBe("success");
  expect(result.logs!.filter((l) => l.level === "warn")).toEqual([
    {
      level: "warn",
      msg: "Chain 'mainnet' is using a public RPC URL (https://cloudflare-eth.com). Most apps require an RPC URL with a higher rate limit.",
    },
  ]);
});

test("buildConfig() handles chains not found in viem", () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1909023431, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event0],
        address: address1,
      },
    },
  });

  const result = safeBuildConfig({
    common: context.common,
    config,
  });

  expect(result.status).toBe("success");
});

test("buildIndexingFunctions() validates event filter event name must be present in ABI", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
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

  const configBuild = buildConfig({
    common: context.common,
    config,
  });
  const result = await safeBuildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild,
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Invalid filter for contract 'a'. Got event name 'Event2', expected one of ['Event0'].",
  );
});

test("buildIndexingFunctions() validates address empty string", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event0],
        address: "" as Address,
      },
    },
  });

  const configBuild = buildConfig({
    common: context.common,
    config,
  });

  const result = await safeBuildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild,
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Invalid prefix for address ''. Got '', expected '0x'.",
  );
});

test("buildIndexingFunctions() validates address prefix", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event0],

        address: "0b0000000000000000000000000000000000000001" as Address,
      },
    },
  });

  const configBuild = buildConfig({ common: context.common, config });
  const result = await safeBuildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild,
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Invalid prefix for address '0b0000000000000000000000000000000000000001'. Got '0b', expected '0x'.",
  );
});

test("buildIndexingFunctions() validates address length", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event0],
        address: "0x000000000001",
      },
    },
  });

  const configBuild = buildConfig({ common: context.common, config });
  const result = await safeBuildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild,
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Invalid length for address '0x000000000001'. Got 14, expected 42 characters.",
  );
});

test("buildIndexingFunctions() coerces NaN startBlock to undefined", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    contracts: {
      a: {
        chain: { mainnet: {} },
        abi: [event0, event1],
        startBlock: Number.NaN,
      },
    },
  });

  const configBuild = buildConfig({ common: context.common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild,
  });

  expect(eventCallbacks[0]![0]?.filter.fromBlock).toBe(undefined);
});

test("buildIndexingFunctions() coerces `latest` to number", async () => {
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

  const configBuild = buildConfig({ common: context.common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild,
  });

  expect(eventCallbacks[0]![0]?.filter.fromBlock).toBeTypeOf("number");
});

test("buildIndexingFunctions() includeTransactionReceipts", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
      optimism: { id: 10, rpc: `http://127.0.0.1:8545/${poolId}` },
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
  const configBuild = buildConfig({ common: context.common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild,
  });

  expect(eventCallbacks[0]![0]!.filter.hasTransactionReceipt).toBe(true);
  expect(eventCallbacks[1]![0]!.filter.hasTransactionReceipt).toBe(false);
});

test("buildIndexingFunctions() includeCallTraces", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
      optimism: { id: 10, rpc: `http://127.0.0.1:8545/${poolId}` },
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

  const configBuild = buildConfig({ common: context.common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a.func0()", fn: () => {} }],
    configBuild,
  });

  expect(eventCallbacks).toHaveLength(1);

  expect(
    (eventCallbacks[0]![0]!.filter as TraceFilter).fromAddress,
  ).toBeUndefined();
  expect((eventCallbacks[0]![0]!.filter as TraceFilter).toAddress).toEqual(
    zeroAddress,
  );
  expect(
    (eventCallbacks[0]![0]!.filter as TraceFilter).functionSelector,
  ).toEqual(toFunctionSelector(func0));
  expect(eventCallbacks[0]![0]!.filter.hasTransactionReceipt).toBe(false);
});

test("buildIndexingFunctions() includeCallTraces with factory", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
      optimism: { id: 10, rpc: `http://127.0.0.1:8545/${poolId}` },
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

  const configBuild = buildConfig({ common: context.common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a.func0()", fn: () => {} }],
    configBuild,
  });

  expect(eventCallbacks).toHaveLength(1);

  expect(
    (eventCallbacks[0]![0]!.filter as TraceFilter).fromAddress,
  ).toBeUndefined();
  expect(
    ((eventCallbacks[0]![0]!.filter as TraceFilter).toAddress as LogFactory)
      .address,
  ).toEqual(address2);
  expect(
    (eventCallbacks[0]![0]!.filter as TraceFilter).functionSelector,
  ).toEqual(toFunctionSelector(func0));
  expect(eventCallbacks[0]![0]!.filter.hasTransactionReceipt).toBe(false);
});

test("buildIndexingFunctions() coerces NaN endBlock to undefined", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    contracts: {
      a: {
        chain: { mainnet: {} },
        abi: [event0, event1],
        endBlock: Number.NaN,
      },
    },
  });

  const configBuild = buildConfig({ common: context.common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild,
  });

  expect(eventCallbacks[0]![0]!.filter.toBlock).toBe(undefined);
});

test("buildIndexingFunctions() account source", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
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

  const configBuild = buildConfig({ common: context.common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [
      { name: "a:transfer:from", fn: () => {} },
      { name: "a:transaction:to", fn: () => {} },
    ],
    configBuild,
  });

  expect(eventCallbacks[0]).toHaveLength(2);

  expect(eventCallbacks[0]![0]?.chain.name).toBe("mainnet");
  expect(eventCallbacks[0]![1]?.chain.name).toBe("mainnet");

  expect(eventCallbacks[0]![0]?.name).toBe("a:transaction:to");
  expect(eventCallbacks[0]![1]?.name).toBe("a:transfer:from");

  expect(eventCallbacks[0]![0]?.filter.type).toBe("transaction");
  expect(eventCallbacks[0]![1]?.filter.type).toBe("transfer");

  expect(eventCallbacks[0]![0]?.filter.fromBlock).toBe(16370000);
  expect(eventCallbacks[0]![1]?.filter.fromBlock).toBe(16370000);

  expect(eventCallbacks[0]![0]?.filter.toBlock).toBe(16370020);
  expect(eventCallbacks[0]![1]?.filter.toBlock).toBe(16370020);
});

test("buildIndexingFunctions() block source", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    blocks: {
      a: {
        chain: { mainnet: {} },
        startBlock: 16370000,
        endBlock: 16370020,
      },
    },
  });

  const configBuild = buildConfig({ common: context.common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a:block", fn: () => {} }],
    configBuild,
  });

  expect(eventCallbacks).toHaveLength(1);

  expect(eventCallbacks[0]![0]?.chain.name).toBe("mainnet");
  expect(eventCallbacks[0]![0]?.name).toBe("a:block");
  expect(eventCallbacks[0]![0]?.filter.type).toBe("block");
  // @ts-ignore
  expect(eventCallbacks[0]![0]?.filter.interval).toBe(1);
  expect(eventCallbacks[0]![0]?.filter.fromBlock).toBe(16370000);
  expect(eventCallbacks[0]![0]?.filter.toBlock).toBe(16370020);
});

test("buildIndexingFunctions() coerces undefined factory interval to source interval", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    contracts: {
      a: {
        chain: { mainnet: {} },
        address: factory({
          address: address2,
          event: eventFactory,
          parameter: "child",
        }),
        abi: [event0, event1],
        startBlock: 16370000,
        endBlock: 16370100,
      },
    },
  });

  const configBuild = buildConfig({ common: context.common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild,
  });

  expect(
    ((eventCallbacks[0]![0]!.filter as LogFilter).address as LogFactory)
      .fromBlock === 16370000,
  );
  expect(
    ((eventCallbacks[0]![0]!.filter as LogFilter).address as LogFactory)
      .toBlock === 16370100,
  );
});

test("buildIndexingFunctions() validates factory interval", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    contracts: {
      a: {
        chain: { mainnet: {} },
        address: factory({
          address: address2,
          event: eventFactory,
          parameter: "child",
          startBlock: 16370050,
        }),
        abi: [event0, event1],
        startBlock: 16370000,
        endBlock: 16370100,
      },
    },
  });

  const configBuild = buildConfig({ common: context.common, config });
  const result = await safeBuildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild,
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Start block for 'a' is before start block of factory address (16370050 > 16370000).",
  );
});

test("buildIndexingFunctions() validates start and end block", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    contracts: {
      a: {
        chain: { mainnet: {} },
        abi: [event0, event1],
        // @ts-expect-error
        startBlock: "16370000",
        // @ts-expect-error
        endBlock: "16370100",
      },
    },
  });

  // @ts-expect-error
  const configBuild = buildConfig({ common: context.common, config });
  const result = await safeBuildIndexingFunctions({
    common: context.common,
    // @ts-expect-error
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild,
  });

  expect(result).toMatchInlineSnapshot(`
    {
      "error": [BuildError: Validation failed: Invalid start block for 'a'. Got 16370000 typeof string, expected an integer.],
      "status": "error",
    }
  `);
});

test("buildIndexingFunctions() returns chain, rpc, and finalized block", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    blocks: {
      b: {
        chain: "mainnet",
      },
    },
  });

  const configBuild = buildConfig({ common: context.common, config });
  const { rpcs, chains, finalizedBlocks } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "b:block", fn: () => {} }],
    configBuild,
  });

  expect(rpcs).toHaveLength(1);
  expect(chains).toHaveLength(1);
  expect(finalizedBlocks).toHaveLength(1);

  expect(chains[0]!.name).toBe("mainnet");
  expect(chains[0]!.id).toBe(1);
  expect(finalizedBlocks[0]!.number).toBe("0x0");
});

test("buildIndexingFunctions() hyperliquid evm", async () => {
  const config = createConfig({
    chains: {
      hyperliquid: { id: 999, rpc: `http://127.0.0.1:8545/${poolId}` },
    },
    blocks: {
      b: {
        chain: "hyperliquid",
      },
    },
  });

  const configBuild = buildConfig({ common: context.common, config });
  const { chains } = await buildIndexingFunctions({
    common: context.common,
    config,
    indexingFunctions: [{ name: "b:block", fn: () => {} }],
    configBuild,
  });

  expect(chains).toHaveLength(1);

  expect(chains[0]!.name).toBe("hyperliquid");
  expect(chains[0]!.id).toBe(999);
  expect(chains[0]!.viemChain).toBe(hyperliquidEvm);
});
