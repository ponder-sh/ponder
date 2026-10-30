import { type Address, parseAbiItem, zeroAddress } from "viem";
import { mainnet } from "viem/chains";
import { expect, test } from "vitest";
import { createStubRpc, createTestCommon } from "@/_test/utils.js";
import { factory } from "@/config/address.js";
import { createConfig } from "@/config/index.js";
import type { EventCallback, IndexingBuild } from "@/internal/types.js";
import { hyperliquidEvm } from "@/utils/chains.js";
import {
  buildConfig,
  buildIndexingFunctions,
  safeBuildConfig,
  safeBuildIndexingFunctions,
} from "./config.js";

const common = createTestCommon();
const rpc = "http://127.0.0.1:8545";
const stubRpc = createStubRpc({ latestBlock: 100 });

/** Built event callbacks without the default `include` lists, for snapshots. */
const getFilters = (eventCallbacks: EventCallback[][]) =>
  eventCallbacks
    .flat()
    .map(({ name, chain, filter: { include: _, ...filter } }) => ({
      name,
      chain: chain.name,
      filter,
    }));

const withStubRpc = <T extends Pick<IndexingBuild, "chains" | "rpcs">>(
  configBuild: T,
): T => ({ ...configBuild, rpcs: configBuild.chains.map(() => stubRpc) });

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

test("buildIndexingFunctions() builds topics for multiple events", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
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
    common,
    config,
  });

  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [
      { name: "a:Event0", fn: () => {} },
      { name: "a:Event1", fn: () => {} },
    ],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "address": "0x0000000000000000000000000000000000000001",
          "chainId": 1,
          "fromBlock": 16370000,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": 16370020,
          "topic0": "0xca7435a70af93ecf41ca56ac8ba6e393f00b2d8663288ceebbd272f23ed2a5d9",
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event0",
      },
      {
        "chain": "mainnet",
        "filter": {
          "address": "0x0000000000000000000000000000000000000001",
          "chainId": 1,
          "fromBlock": 16370000,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": 16370020,
          "topic0": "0xeb0647d2fd18e9d48417458d5ceb82e5e455b589086e6a791507d38a59f9f5cb",
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event1",
      },
    ]
  `);
});

test("buildIndexingFunctions() handles overloaded event signatures and combines topics", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
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
    common,
    config,
  });
  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [
      { name: "a:Event1()", fn: () => {} },
      { name: "a:Event1(bytes32 indexed)", fn: () => {} },
    ],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "address": "0x0000000000000000000000000000000000000001",
          "chainId": 1,
          "fromBlock": 16370000,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": 16370020,
          "topic0": "0xeb0647d2fd18e9d48417458d5ceb82e5e455b589086e6a791507d38a59f9f5cb",
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event1()",
      },
      {
        "chain": "mainnet",
        "filter": {
          "address": "0x0000000000000000000000000000000000000001",
          "chainId": 1,
          "fromBlock": 16370000,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": 16370020,
          "topic0": "0x8c5ef8f5670e096749c7d0bd79364744b28e871bc6c65c5541b0b30f727ad8be",
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event1(bytes32 indexed)",
      },
    ]
  `);
});

test("buildIndexingFunctions() handles multiple addresses", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
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
    common,
    config,
  });
  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [
      { name: "a:Event1()", fn: () => {} },
      { name: "a:Event1(bytes32 indexed)", fn: () => {} },
    ],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "address": [
            "0x0000000000000000000000000000000000000001",
            "0x0000000000000000000000000000000000000003",
          ],
          "chainId": 1,
          "fromBlock": 16370000,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": 16370020,
          "topic0": "0xeb0647d2fd18e9d48417458d5ceb82e5e455b589086e6a791507d38a59f9f5cb",
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event1()",
      },
      {
        "chain": "mainnet",
        "filter": {
          "address": [
            "0x0000000000000000000000000000000000000001",
            "0x0000000000000000000000000000000000000003",
          ],
          "chainId": 1,
          "fromBlock": 16370000,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": 16370020,
          "topic0": "0x8c5ef8f5670e096749c7d0bd79364744b28e871bc6c65c5541b0b30f727ad8be",
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event1(bytes32 indexed)",
      },
    ]
  `);
});

test("buildIndexingFunctions() creates a source for each chain for multi-chain contracts", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
      optimism: { id: 10, rpc },
    },
    contracts: {
      a: {
        chain: { mainnet: {}, optimism: {} },
        abi: [event0],
      },
    },
  });

  const configBuild = buildConfig({
    common,
    config,
  });
  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "address": undefined,
          "chainId": 1,
          "fromBlock": undefined,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": undefined,
          "topic0": "0xca7435a70af93ecf41ca56ac8ba6e393f00b2d8663288ceebbd272f23ed2a5d9",
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event0",
      },
      {
        "chain": "optimism",
        "filter": {
          "address": undefined,
          "chainId": 10,
          "fromBlock": undefined,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": undefined,
          "topic0": "0xca7435a70af93ecf41ca56ac8ba6e393f00b2d8663288ceebbd272f23ed2a5d9",
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event0",
      },
    ]
  `);
});

test("buildIndexingFunctions() throw useful error for common 0.11 migration mistakes", async () => {
  const indexingFunctions = [{ name: "a:Event0", fn: () => {} }];

  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
      optimism: { id: 10, rpc },
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
    common,
    // @ts-expect-error
    config,
  });

  const result = await safeBuildIndexingFunctions({
    common,
    // @ts-expect-error
    config,
    indexingFunctions,
    configBuild: withStubRpc(configBuild),
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toMatchInlineSnapshot(
    `"Validation failed: Chain for 'a' is null or undefined. Expected one of ['mainnet', 'optimism']. Did you forget to change 'network' to 'chain' when migrating to 0.11?"`,
  );
});

test("buildIndexingFunctions() builds topics for event filter", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
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
    common,
    config,
  });
  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "address": "0x0000000000000000000000000000000000000001",
          "chainId": 1,
          "fromBlock": 16370000,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": 16370020,
          "topic0": "0xca7435a70af93ecf41ca56ac8ba6e393f00b2d8663288ceebbd272f23ed2a5d9",
          "topic1": "0x0000000000000000000000000000000000000000000000000000000000000001",
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event0",
      },
    ]
  `);
});

test("buildIndexingFunctions() builds topics for multiple event filters", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
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
    common,
    config,
  });
  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [
      { name: "a:Event0", fn: () => {} },
      { name: "a:Event1", fn: () => {} },
    ],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "address": "0x0000000000000000000000000000000000000001",
          "chainId": 1,
          "fromBlock": 16370000,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": 16370020,
          "topic0": "0xca7435a70af93ecf41ca56ac8ba6e393f00b2d8663288ceebbd272f23ed2a5d9",
          "topic1": "0x0000000000000000000000000000000000000000000000000000000000000001",
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event0",
      },
      {
        "chain": "mainnet",
        "filter": {
          "address": "0x0000000000000000000000000000000000000001",
          "chainId": 1,
          "fromBlock": 16370000,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": 16370020,
          "topic0": "0x8c5ef8f5670e096749c7d0bd79364744b28e871bc6c65c5541b0b30f727ad8be",
          "topic1": [
            "0x0000000000000000000000000000000000000000000000000000000000000001",
            "0x0000000000000000000000000000000000000000000000000000000000000002",
          ],
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event1",
      },
    ]
  `);
});

test("buildIndexingFunctions() overrides default values with chain-specific values", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
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
    common,
    config,
  });
  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "address": "0x0000000000000000000000000000000000000001",
          "chainId": 1,
          "fromBlock": 16370000,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": 16370020,
          "topic0": "0xca7435a70af93ecf41ca56ac8ba6e393f00b2d8663288ceebbd272f23ed2a5d9",
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event0",
      },
    ]
  `);
});

test("buildIndexingFunctions() handles chain name shortcut", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
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
    common,
    config,
  });
  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "address": "0x0000000000000000000000000000000000000001",
          "chainId": 1,
          "fromBlock": 16370000,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": 16370020,
          "topic0": "0xca7435a70af93ecf41ca56ac8ba6e393f00b2d8663288ceebbd272f23ed2a5d9",
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event0",
      },
    ]
  `);
});

test("buildIndexingFunctions() validates chain name", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
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
    common,
    config,
  });
  const result = await safeBuildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toMatchInlineSnapshot(
    `"Validation failed: Invalid chain for 'a'. Got 'mainnetz', expected one of ['mainnet']."`,
  );
});

test("buildConfig() warns for public RPC URL", () => {
  // Note: The warning matches the chain's default RPC URL in `viem/chains`.
  const publicRpc = mainnet.rpcUrls.default.http[0];
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: publicRpc },
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
    common,
    config,
  });

  expect(result.status).toBe("success");
  const warnings = result.logs!.filter((l) => l.level === "warn");
  expect(warnings.map(({ url }) => url)).toStrictEqual([publicRpc]);
  expect(warnings.map(({ url: _, ...log }) => log)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "chain_id": 1,
        "level": "warn",
        "msg": "Detected public RPC URL. Most apps require an RPC URL with a higher rate limit.",
      },
    ]
  `);
});

test("buildConfig() handles chains not found in viem", () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1909023431, rpc },
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
    common,
    config,
  });

  expect(result.status).toBe("success");
});

test("buildIndexingFunctions() validates event filter event name must be present in ABI", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
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
    common,
    config,
  });
  const result = await safeBuildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toMatchInlineSnapshot(
    `"Validation failed: Invalid filter for contract 'a'. Got event name 'Event2', expected one of ['Event0']."`,
  );
});

test("buildIndexingFunctions() validates address empty string", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
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
    common,
    config,
  });

  const result = await safeBuildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toMatchInlineSnapshot(
    `"Validation failed: Invalid prefix for address ''. Got '', expected '0x'."`,
  );
});

test("buildIndexingFunctions() validates empty contract address array", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event0],
        address: [],
      },
    },
  });

  const configBuild = buildConfig({ common, config });
  const result = await safeBuildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toMatchInlineSnapshot(
    `"Validation failed: Invalid address for 'a'. Got an empty array, expected at least one address."`,
  );
});

test("buildIndexingFunctions() validates empty account address array", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
    },
    accounts: {
      a: {
        chain: "mainnet",
        address: [],
      },
    },
  });

  const configBuild = buildConfig({ common, config });
  const result = await safeBuildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:transaction:to", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toMatchInlineSnapshot(
    `"Validation failed: Invalid address for 'a'. Got an empty array, expected at least one address."`,
  );
});

test("buildIndexingFunctions() validates empty factory address array", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event0],
        address: factory({
          address: [],
          event: eventFactory,
          parameter: "child",
        }),
      },
    },
  });

  const configBuild = buildConfig({ common, config });
  const result = await safeBuildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toMatchInlineSnapshot(
    `"Validation failed: Invalid address for 'a'. Got an empty array, expected at least one address."`,
  );
});

test("buildIndexingFunctions() validates address prefix", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event0],

        address: "0b0000000000000000000000000000000000000001" as Address,
      },
    },
  });

  const configBuild = buildConfig({ common, config });
  const result = await safeBuildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toMatchInlineSnapshot(
    `"Validation failed: Invalid prefix for address '0b0000000000000000000000000000000000000001'. Got '0b', expected '0x'."`,
  );
});

test("buildIndexingFunctions() validates address length", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
    },
    contracts: {
      a: {
        chain: "mainnet",
        abi: [event0],
        address: "0x000000000001",
      },
    },
  });

  const configBuild = buildConfig({ common, config });
  const result = await safeBuildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toMatchInlineSnapshot(
    `"Validation failed: Invalid length for address '0x000000000001'. Got 14, expected 42 characters."`,
  );
});

test("buildIndexingFunctions() coerces NaN startBlock to undefined", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
    },
    contracts: {
      a: {
        chain: { mainnet: {} },
        abi: [event0, event1],
        startBlock: Number.NaN,
      },
    },
  });

  const configBuild = buildConfig({ common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "address": undefined,
          "chainId": 1,
          "fromBlock": undefined,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": undefined,
          "topic0": "0xca7435a70af93ecf41ca56ac8ba6e393f00b2d8663288ceebbd272f23ed2a5d9",
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event0",
      },
    ]
  `);
});

test("buildIndexingFunctions() coerces `latest` to number", async () => {
  const config = createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: rpc,
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

  const configBuild = buildConfig({ common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "address": undefined,
          "chainId": 1,
          "fromBlock": 100,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": undefined,
          "topic0": "0xca7435a70af93ecf41ca56ac8ba6e393f00b2d8663288ceebbd272f23ed2a5d9",
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event0",
      },
    ]
  `);
});

test("buildIndexingFunctions() includeTransactionReceipts", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
      optimism: { id: 10, rpc },
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
  const configBuild = buildConfig({ common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "address": undefined,
          "chainId": 1,
          "fromBlock": undefined,
          "hasTransactionReceipt": true,
          "sourceId": "a",
          "toBlock": undefined,
          "topic0": "0xca7435a70af93ecf41ca56ac8ba6e393f00b2d8663288ceebbd272f23ed2a5d9",
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event0",
      },
      {
        "chain": "optimism",
        "filter": {
          "address": undefined,
          "chainId": 10,
          "fromBlock": undefined,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": undefined,
          "topic0": "0xca7435a70af93ecf41ca56ac8ba6e393f00b2d8663288ceebbd272f23ed2a5d9",
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event0",
      },
    ]
  `);
});

test("buildIndexingFunctions() includeCallTraces", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
      optimism: { id: 10, rpc },
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

  const configBuild = buildConfig({ common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a.func0()", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "callType": "CALL",
          "chainId": 1,
          "fromAddress": undefined,
          "fromBlock": undefined,
          "functionSelector": "0xf8be7e52",
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toAddress": "0x0000000000000000000000000000000000000000",
          "toBlock": undefined,
          "type": "trace",
        },
        "name": "a.func0()",
      },
    ]
  `);
});

test("buildIndexingFunctions() includeCallTraces with factory", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
      optimism: { id: 10, rpc },
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

  const configBuild = buildConfig({ common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a.func0()", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "callType": "CALL",
          "chainId": 1,
          "fromAddress": undefined,
          "fromBlock": undefined,
          "functionSelector": "0xf8be7e52",
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toAddress": {
            "address": "0x0000000000000000000000000000000000000001",
            "chainId": 1,
            "childAddressLocation": "topic1",
            "eventSelector": "0x3032dacf24474e98fa8d177486690dcac56523635af423cfb1dcc34f0646322e",
            "fromBlock": undefined,
            "id": "log_0x0000000000000000000000000000000000000001_1_topic1_0x3032dacf24474e98fa8d177486690dcac56523635af423cfb1dcc34f0646322e_undefined_undefined",
            "sourceId": "a",
            "toBlock": undefined,
            "type": "log",
          },
          "toBlock": undefined,
          "type": "trace",
        },
        "name": "a.func0()",
      },
    ]
  `);
});

test("buildIndexingFunctions() coerces NaN endBlock to undefined", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
    },
    contracts: {
      a: {
        chain: { mainnet: {} },
        abi: [event0, event1],
        endBlock: Number.NaN,
      },
    },
  });

  const configBuild = buildConfig({ common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "address": undefined,
          "chainId": 1,
          "fromBlock": undefined,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": undefined,
          "topic0": "0xca7435a70af93ecf41ca56ac8ba6e393f00b2d8663288ceebbd272f23ed2a5d9",
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event0",
      },
    ]
  `);
});

test("buildIndexingFunctions() account source", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
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

  const configBuild = buildConfig({ common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [
      { name: "a:transfer:from", fn: () => {} },
      { name: "a:transaction:to", fn: () => {} },
    ],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "chainId": 1,
          "fromAddress": undefined,
          "fromBlock": 16370000,
          "hasTransactionReceipt": true,
          "sourceId": "a",
          "toAddress": "0x0000000000000000000000000000000000000001",
          "toBlock": 16370020,
          "type": "transaction",
        },
        "name": "a:transaction:to",
      },
      {
        "chain": "mainnet",
        "filter": {
          "chainId": 1,
          "fromAddress": "0x0000000000000000000000000000000000000001",
          "fromBlock": 16370000,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toAddress": undefined,
          "toBlock": 16370020,
          "type": "transfer",
        },
        "name": "a:transfer:from",
      },
    ]
  `);
});

test("buildIndexingFunctions() block source", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
    },
    blocks: {
      a: {
        chain: { mainnet: {} },
        startBlock: 16370000,
        endBlock: 16370020,
      },
    },
  });

  const configBuild = buildConfig({ common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:block", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "chainId": 1,
          "fromBlock": 16370000,
          "hasTransactionReceipt": false,
          "interval": 1,
          "offset": 0,
          "sourceId": "a",
          "toBlock": 16370020,
          "type": "block",
        },
        "name": "a:block",
      },
    ]
  `);
});

test("buildIndexingFunctions() coerces undefined factory interval to source interval", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
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

  const configBuild = buildConfig({ common, config });
  const { eventCallbacks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(getFilters(eventCallbacks)).toMatchInlineSnapshot(`
    [
      {
        "chain": "mainnet",
        "filter": {
          "address": {
            "address": "0x0000000000000000000000000000000000000001",
            "chainId": 1,
            "childAddressLocation": "topic1",
            "eventSelector": "0x3032dacf24474e98fa8d177486690dcac56523635af423cfb1dcc34f0646322e",
            "fromBlock": 16370000,
            "id": "log_0x0000000000000000000000000000000000000001_1_topic1_0x3032dacf24474e98fa8d177486690dcac56523635af423cfb1dcc34f0646322e_16370000_16370100",
            "sourceId": "a",
            "toBlock": 16370100,
            "type": "log",
          },
          "chainId": 1,
          "fromBlock": 16370000,
          "hasTransactionReceipt": false,
          "sourceId": "a",
          "toBlock": 16370100,
          "topic0": "0xca7435a70af93ecf41ca56ac8ba6e393f00b2d8663288ceebbd272f23ed2a5d9",
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
        "name": "a:Event0",
      },
    ]
  `);
});

test("buildIndexingFunctions() validates factory interval", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
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

  const configBuild = buildConfig({ common, config });
  const result = await safeBuildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toMatchInlineSnapshot(
    `"Validation failed: Start block for 'a' is before start block of factory address (16370050 > 16370000)."`,
  );
});

test("buildIndexingFunctions() validates start and end block", async () => {
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc },
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
  const configBuild = buildConfig({ common, config });
  const result = await safeBuildIndexingFunctions({
    common,
    // @ts-expect-error
    config,
    indexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
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
      mainnet: { id: 1, rpc },
    },
    blocks: {
      b: {
        chain: "mainnet",
      },
    },
  });

  const configBuild = buildConfig({ common, config });
  const { rpcs, chains, finalizedBlocks } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "b:block", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(rpcs).toHaveLength(1);
  expect(chains).toHaveLength(1);
  expect(finalizedBlocks).toHaveLength(1);

  expect(chains[0]!.name).toBe("mainnet");
  expect(chains[0]!.id).toBe(1);
  expect(finalizedBlocks[0]!.number).toBe("0x0");
});

test("buildConfig() uses the configured reorg window", () => {
  const config = createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: rpc,
        reorgWindow: 120,
      },
    },
    blocks: { b: { chain: "mainnet" } },
  });

  const { chains } = buildConfig({ common, config });

  expect(chains[0]!.reorgWindow).toBe(120);
});

test("buildConfig() defaults the reorg window to 180 seconds", () => {
  const config = createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: rpc,
      },
    },
    blocks: { b: { chain: "mainnet" } },
  });

  const { chains } = buildConfig({ common, config });

  expect(chains[0]!.reorgWindow).toBe(180);
});

test.each([0, 600])(
  "buildConfig() accepts a reorg window of %s seconds",
  (reorgWindow) => {
    const config = createConfig({
      chains: {
        mainnet: {
          id: 1,
          rpc: rpc,
          reorgWindow,
        },
      },
      blocks: { b: { chain: "mainnet" } },
    });

    const { chains } = buildConfig({ common, config });

    expect(chains[0]!.reorgWindow).toBe(reorgWindow);
  },
);

test.each([-1, 1.5, 601, Number.NaN])(
  "buildConfig() rejects an invalid reorg window of %s",
  (reorgWindow) => {
    const config = createConfig({
      chains: {
        mainnet: {
          id: 1,
          rpc: rpc,
          reorgWindow,
        },
      },
      blocks: { b: { chain: "mainnet" } },
    });

    expect(() => buildConfig({ common, config })).toThrow(
      `Invalid 'reorgWindow' for chain 'mainnet'. Expected an integer between 0 and 600 seconds, got ${reorgWindow}.`,
    );
  },
);

test("buildIndexingFunctions() hyperliquid evm", async () => {
  const config = createConfig({
    chains: {
      hyperliquid: { id: 999, rpc },
    },
    blocks: {
      b: {
        chain: "hyperliquid",
      },
    },
  });

  const configBuild = buildConfig({ common, config });
  const { chains } = await buildIndexingFunctions({
    common,
    config,
    indexingFunctions: [{ name: "b:block", fn: () => {} }],
    configBuild: withStubRpc(configBuild),
  });

  expect(chains).toHaveLength(1);

  expect(chains[0]!.name).toBe("hyperliquid");
  expect(chains[0]!.id).toBe(999);
  expect(chains[0]!.viemChain).toBe(hyperliquidEvm);
});
