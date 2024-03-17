import type { Options } from "@/common/options.js";
import { http, getEventSelector, parseAbiItem } from "viem";
import { expect, test } from "vitest";
import { type Config, createConfig } from "../../config/config.js";
import { buildConfig, safeBuildConfig } from "./config.js";

const event0 = parseAbiItem("event Event0(bytes32 indexed arg)");
const event1 = parseAbiItem("event Event1()");
const event1Overloaded = parseAbiItem("event Event1(bytes32 indexed)");
const eventFactory = parseAbiItem("event EventFactory(address indexed child)");

const address1 = "0x0000000000000000000000000000000000000001";
const address2 = "0x0000000000000000000000000000000000000001";
const bytes1 =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
const bytes2 =
  "0x0000000000000000000000000000000000000000000000000000000000000002";
const options = {
  ponderDir: "ponderDir",
  rootDir: "rootDir",
} as const satisfies Pick<Options, "rootDir" | "ponderDir">;

test("buildConfig() builds topics for multiple events", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      a: {
        network: { mainnet: {} },
        abi: [event0, event1],
        filter: { event: ["Event0", "Event1"] },
        address: address1,
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    },
  });

  const { sources } = await buildConfig({ config, options });

  expect(sources[0].criteria.topics).toMatchObject([
    [getEventSelector(event0), getEventSelector(event1)],
  ]);
});

test("buildConfig() handles overloaded event signatures and combines topics", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      BaseRegistrartImplementation: {
        network: { mainnet: {} },
        abi: [event1, event1Overloaded],
        filter: {
          event: ["Event1()", "Event1(bytes32 indexed)"],
        },
        address: address1,
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    },
  });

  const { sources } = await buildConfig({ config, options });

  expect(sources[0].criteria.topics).toMatchObject([
    [getEventSelector(event1), getEventSelector(event1Overloaded)],
  ]);
});

test("buildConfig() creates a source for each network for multi-network contracts", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
      optimism: { chainId: 10, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      a: {
        network: { mainnet: {}, optimism: {} },
        abi: [event0],
      },
    },
  });

  const { sources } = await buildConfig({ config, options });

  expect(sources.length).toBe(2);
});

test("buildConfig() builds topics for event with args", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      a: {
        network: { mainnet: {} },
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
        maxBlockRange: 10,
      },
    },
  });

  const { sources } = await buildConfig({ config, options });

  expect(sources[0].criteria.topics).toMatchObject([
    getEventSelector(event0),
    bytes1,
  ]);
});

test("buildConfig() builds topics for event with unnamed parameters", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      a: {
        network: { mainnet: {} },
        abi: [event1Overloaded],
        filter: {
          event: "Event1",
          args: [[bytes1, bytes2]],
        },
        address: address1,
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    },
  });

  const { sources } = await buildConfig({ config, options });

  expect(sources[0].criteria.topics).toMatchObject([
    getEventSelector(event1Overloaded),
    [bytes1, bytes2],
  ]);
});

test("buildConfig() overrides default values with network-specific values", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      a: {
        abi: [event0],
        filter: { event: ["Event0"] },
        address: address1,
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
        network: {
          mainnet: {
            address: address2,
          },
        },
      },
    },
  });

  const { sources } = await buildConfig({ config, options });

  expect(sources[0].criteria.address).toBe(address2);
});

test("buildConfig() handles network name shortcut", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      a: {
        network: "mainnet",
        abi: [event0],
        filter: { event: ["Event0"] },
        address: address1,
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    },
  });

  const { sources } = await buildConfig({ config, options });

  expect(sources[0].networkName).toBe("mainnet");
});

test("buildConfig() validates network name", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      a: {
        // @ts-expect-error
        network: "mainnetz",
        abi: [event0],
        address: address1,
      },
    },
  });

  const result = await safeBuildConfig({ config, options });

  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Invalid network for contract 'a'. Got 'mainnetz', expected one of ['mainnet'].",
  );
});

test("buildConfig() warns for public RPC URL", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("https://cloudflare-eth.com") },
    },
    contracts: {
      a: {
        network: "mainnet",
        abi: [event0],
        address: address1,
      },
    },
  });

  const result = await safeBuildConfig({ config, options });

  expect(result.success).toBe(true);
  expect(result.data?.logs[1]).toStrictEqual({
    level: "warn",
    msg: "Network 'mainnet' is using a public RPC URL (https://cloudflare-eth.com). Most apps require an RPC URL with a higher rate limit.",
  });
});

test("buildConfig() validates against multiple events and indexed argument values", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("https://cloudflare-eth.com") },
    },
    contracts: {
      a: {
        network: "mainnet",
        abi: [event0, event1],
        filter: {
          event: ["Event0", "Event1"],
          // @ts-expect-error
          args: [bytes1],
        },
      },
    },
  }) as any;

  const result = await safeBuildConfig({ config, options });

  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Event filter for contract 'a' cannot contain indexed argument values if multiple events are provided.",
  );
});

test("buildConfig() validates event filter event name must be present in ABI", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("https://cloudflare-eth.com") },
    },
    contracts: {
      a: {
        network: "mainnet",
        abi: [event0],
        filter: {
          // @ts-expect-error
          event: "Event2",
        },
      },
    },
  });

  const result = await safeBuildConfig({ config, options });

  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Invalid filter for contract 'a'. Got event name 'Event2', expected one of ['Event0'].",
  );
});

test("buildConfig() validates against specifying both factory and address", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("https://cloudflare-eth.com") },
    },
    contracts: {
      a: {
        network: "mainnet",
        abi: [event0],
        // @ts-expect-error
        address: address1,
        factory: {
          address: address2,
          event: eventFactory,
          parameter: "child",
        },
      },
    },
  });

  const result = await safeBuildConfig({ config, options });

  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Contract 'a' cannot specify both 'factory' and 'address' options.",
  );
});

test("buildConfig() validates address prefix", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("https://cloudflare-eth.com") },
    },
    contracts: {
      a: {
        network: "mainnet",
        abi: [event0],
        // @ts-expect-error
        address: "0b0000000000000000000000000000000000000001",
      },
    },
  }) as Config;

  const result = await safeBuildConfig({ config, options });

  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Invalid prefix for address '0b0000000000000000000000000000000000000001'. Got '0b', expected '0x'.",
  );
});

test("buildConfig() validates address length", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("https://cloudflare-eth.com") },
    },
    contracts: {
      a: {
        network: "mainnet",
        abi: [event0],
        address: "0x000000000001",
      },
    },
  });

  const result = await safeBuildConfig({ config, options });

  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Invalid length for address '0x000000000001'. Got 14, expected 42 characters.",
  );
});

test("buildConfig() coerces NaN startBlock to 0", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      a: {
        network: { mainnet: {} },
        abi: [event0, event1],
        startBlock: NaN,
      },
    },
  });

  const { sources } = await buildConfig({ config, options });

  expect(sources[0].startBlock).toBe(0);
});

test("buildConfig() coerces NaN endBlock to undefined", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      a: {
        network: { mainnet: {} },
        abi: [event0, event1],
        endBlock: NaN,
      },
    },
  });

  const { sources } = await buildConfig({ config, options });

  expect(sources[0].endBlock).toBe(undefined);
});
