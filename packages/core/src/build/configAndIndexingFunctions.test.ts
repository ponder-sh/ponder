import path from "node:path";
import type { Options } from "@/common/options.js";
import type { CallTraceFilter, LogFactory, LogFilter } from "@/sync/source.js";
import {
  http,
  type Address,
  getEventSelector,
  getFunctionSelector,
  parseAbiItem,
  zeroAddress,
} from "viem";
import { expect, test, vi } from "vitest";
import { type Config, createConfig } from "../config/config.js";
import {
  buildConfigAndIndexingFunctions,
  safeBuildConfigAndIndexingFunctions,
} from "./configAndIndexingFunctions.js";

const event0 = parseAbiItem("event Event0(bytes32 indexed arg)");
const event1 = parseAbiItem("event Event1()");
const event1Overloaded = parseAbiItem("event Event1(bytes32 indexed)");
const eventFactory = parseAbiItem("event EventFactory(address indexed child)");
const func0 = parseAbiItem(
  "function func0(address) external returns (uint256)",
);

const address1 = "0x0000000000000000000000000000000000000001";
const address2 = "0x0000000000000000000000000000000000000001";
const bytes1 =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
const bytes2 =
  "0x0000000000000000000000000000000000000000000000000000000000000002";
const options = {
  ponderDir: ".ponder",
  rootDir: "rootDir",
} as const satisfies Pick<Options, "rootDir" | "ponderDir">;

test("buildConfigAndIndexingFunctions() builds topics for multiple events", async () => {
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
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [
      { name: "a:Event0", fn: () => {} },
      { name: "a:Event1", fn: () => {} },
    ],
    options,
  });

  expect((sources[0]!.filter as LogFilter).topics).toMatchObject([
    [getEventSelector(event0), getEventSelector(event1)],
  ]);
});

test("buildConfigAndIndexingFunctions() handles overloaded event signatures and combines topics", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      a: {
        network: { mainnet: {} },
        abi: [event1, event1Overloaded],
        filter: {
          event: ["Event1()", "Event1(bytes32 indexed)"],
        },
        address: address1,
        startBlock: 16370000,
        endBlock: 16370020,
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [
      { name: "a:Event1()", fn: () => {} },
      { name: "a:Event1(bytes32 indexed)", fn: () => {} },
    ],
    options,
  });

  expect((sources[0]!.filter as LogFilter).topics).toMatchObject([
    [getEventSelector(event1), getEventSelector(event1Overloaded)],
  ]);
});

test("buildConfigAndIndexingFunctions() creates a source for each network for multi-network contracts", async () => {
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

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });

  expect(sources.length).toBe(2);
});

test("buildConfigAndIndexingFunctions() builds topics for event with args", async () => {
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
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });

  expect((sources[0]!.filter as LogFilter).topics).toMatchObject([
    [getEventSelector(event0)],
    bytes1,
  ]);
});

test("buildConfigAndIndexingFunctions() builds topics for event with unnamed parameters", async () => {
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
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event1", fn: () => {} }],
    options,
  });

  expect((sources[0]!.filter as LogFilter).topics).toMatchObject([
    [getEventSelector(event1Overloaded)],
    [bytes1, bytes2],
  ]);
});

test("buildConfigAndIndexingFunctions() overrides default values with network-specific values", async () => {
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
        network: {
          mainnet: {
            address: address2,
          },
        },
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });

  expect((sources[0]!.filter as LogFilter).address).toBe(address2);
});

test("buildConfigAndIndexingFunctions() handles network name shortcut", async () => {
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
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });

  expect(sources[0]!.networkName).toBe("mainnet");
});

test("buildConfigAndIndexingFunctions() validates network name", async () => {
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

  const result = await safeBuildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Invalid network for contract 'a'. Got 'mainnetz', expected one of ['mainnet'].",
  );
});

test("buildConfigAndIndexingFunctions() warns for public RPC URL", async () => {
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

  const result = await safeBuildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });

  expect(result.status).toBe("success");
  expect(result.logs!.filter((l) => l.level === "warn")).toMatchObject([
    {
      level: "warn",
      msg: "Network 'mainnet' is using a public RPC URL (https://cloudflare-eth.com). Most apps require an RPC URL with a higher rate limit.",
    },
  ]);
});

test("buildConfigAndIndexingFunctions() validates against multiple events and indexed argument values", async () => {
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

  const result = await safeBuildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Event filter for contract 'a' cannot contain indexed argument values if multiple events are provided.",
  );
});

test("buildConfigAndIndexingFunctions() validates event filter event name must be present in ABI", async () => {
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

  const result = await safeBuildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Invalid filter for contract 'a'. Got event name 'Event2', expected one of ['Event0'].",
  );
});

test("buildConfigAndIndexingFunctions() validates against specifying both factory and address", async () => {
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

  const result = await safeBuildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Contract 'a' cannot specify both 'factory' and 'address' options.",
  );
});

test("buildConfigAndIndexingFunctions() validates address empty string", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("https://cloudflare-eth.com") },
    },
    contracts: {
      a: {
        network: "mainnet",
        abi: [event0],
        address: "" as Address,
      },
    },
  }) as Config;

  const result = await safeBuildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Invalid prefix for address ''. Got '', expected '0x'.",
  );
});

test("buildConfigAndIndexingFunctions() validates address prefix", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("https://cloudflare-eth.com") },
    },
    contracts: {
      a: {
        network: "mainnet",
        abi: [event0],

        address: "0b0000000000000000000000000000000000000001" as Address,
      },
    },
  }) as Config;

  const result = await safeBuildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Invalid prefix for address '0b0000000000000000000000000000000000000001'. Got '0b', expected '0x'.",
  );
});

test("buildConfigAndIndexingFunctions() validates address length", async () => {
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

  const result = await safeBuildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });

  expect(result.status).toBe("error");
  expect(result.error?.message).toBe(
    "Validation failed: Invalid length for address '0x000000000001'. Got 14, expected 42 characters.",
  );
});

test("buildConfigAndIndexingFunctions() coerces NaN startBlock to 0", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      a: {
        network: { mainnet: {} },
        abi: [event0, event1],
        startBlock: Number.NaN,
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });

  expect(sources[0]?.filter.fromBlock).toBe(0);
});

test("buildConfigAndIndexingFunctions() includeTransactionReceipts", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
      optimism: { chainId: 10, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      a: {
        includeTransactionReceipts: true,
        network: {
          mainnet: {},
          optimism: { includeTransactionReceipts: false },
        },
        abi: [event0],
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });

  expect((sources[0]!.filter as LogFilter).includeTransactionReceipts).toBe(
    true,
  );
  expect((sources[1]!.filter as LogFilter).includeTransactionReceipts).toBe(
    false,
  );
});

test("buildConfigAndIndexingFunctions() includeCallTraces", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
      optimism: { chainId: 10, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      a: {
        includeCallTraces: true,
        network: {
          mainnet: {},
          optimism: { includeCallTraces: false },
        },
        address: zeroAddress,
        abi: [func0],
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a.func0()", fn: () => {} }],
    options,
  });

  expect(sources).toHaveLength(1);

  expect((sources[0]!.filter as CallTraceFilter).fromAddress).toBeUndefined();
  expect((sources[0]!.filter as CallTraceFilter).toAddress).toMatchObject([
    zeroAddress,
  ]);
  expect(
    (sources[0]!.filter as CallTraceFilter).functionSelectors,
  ).toMatchObject([getFunctionSelector(func0)]);
  expect(
    (sources[0]!.filter as CallTraceFilter).includeTransactionReceipts,
  ).toBe(false);
});

test("buildConfigAndIndexingFunctions() includeCallTraces with factory", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
      optimism: { chainId: 10, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      a: {
        includeCallTraces: true,
        network: {
          mainnet: {},
          optimism: { includeCallTraces: false },
        },
        factory: {
          address: address2,
          event: eventFactory,
          parameter: "child",
        },
        abi: [func0],
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a.func0()", fn: () => {} }],
    options,
  });

  expect(sources).toHaveLength(1);

  expect((sources[0]!.filter as CallTraceFilter).fromAddress).toBeUndefined();
  expect(
    ((sources[0]!.filter as CallTraceFilter).toAddress as LogFactory).address,
  ).toMatchObject(address2);
  expect(
    (sources[0]!.filter as CallTraceFilter).functionSelectors,
  ).toMatchObject([getFunctionSelector(func0)]);
  expect(
    (sources[0]!.filter as CallTraceFilter).includeTransactionReceipts,
  ).toBe(false);
});

test("buildConfigAndIndexingFunctions() coerces NaN endBlock to undefined", async () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      a: {
        network: { mainnet: {} },
        abi: [event0, event1],
        endBlock: Number.NaN,
      },
    },
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });

  expect(sources[0]!.filter.toBlock).toBe(undefined);
});

test("buildConfigAndIndexingFunctions() database uses sqlite by default", async () => {
  const config = createConfig({
    networks: { mainnet: { chainId: 1, transport: http() } },
    contracts: { a: { network: "mainnet", abi: [event0] } },
  });

  const prev = process.env.DATABASE_URL;
  // biome-ignore lint/performance/noDelete: Required to test default behavior.
  delete process.env.DATABASE_URL;

  const { databaseConfig } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });
  expect(databaseConfig).toMatchObject({
    kind: "sqlite",
    directory: expect.stringContaining(path.join(".ponder", "sqlite")),
  });

  process.env.DATABASE_URL = prev;
});

test("buildConfigAndIndexingFunctions() database respects custom sqlite path", async () => {
  const config = createConfig({
    database: { kind: "sqlite", directory: "custom-sqlite/directory" },
    networks: { mainnet: { chainId: 1, transport: http() } },
    contracts: { a: { network: "mainnet", abi: [event0] } },
  });

  const { databaseConfig } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });

  expect(databaseConfig).toMatchObject({
    kind: "sqlite",
    directory: expect.stringContaining(path.join("custom-sqlite", "directory")),
  });
});

test("buildConfigAndIndexingFunctions() database uses sqlite if specified even if DATABASE_URL env var present", async () => {
  const config = createConfig({
    database: { kind: "sqlite" },
    networks: { mainnet: { chainId: 1, transport: http() } },
    contracts: { a: { network: "mainnet", abi: [event0] } },
  });

  vi.stubEnv("DATABASE_URL", "postgres://username@localhost:5432/database");

  const { databaseConfig } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });
  expect(databaseConfig).toMatchObject({
    kind: "sqlite",
    directory: expect.stringContaining(path.join(".ponder", "sqlite")),
  });

  vi.unstubAllEnvs();
});

test("buildConfigAndIndexingFunctions() database uses postgres if DATABASE_URL env var present", async () => {
  const config = createConfig({
    networks: { mainnet: { chainId: 1, transport: http() } },
    contracts: { a: { network: "mainnet", abi: [event0] } },
  });

  vi.stubEnv("DATABASE_URL", "postgres://username@localhost:5432/database");

  const { databaseConfig } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });
  expect(databaseConfig).toMatchObject({
    kind: "postgres",
    poolConfig: {
      connectionString: "postgres://username@localhost:5432/database",
    },
    schema: "public",
  });

  vi.unstubAllEnvs();
});

test("buildConfigAndIndexingFunctions() database uses postgres if DATABASE_PRIVATE_URL env var present", async () => {
  const config = createConfig({
    networks: { mainnet: { chainId: 1, transport: http() } },
    contracts: { a: { network: "mainnet", abi: [event0] } },
  });

  vi.stubEnv("DATABASE_URL", "postgres://username@localhost:5432/database");
  vi.stubEnv(
    "DATABASE_PRIVATE_URL",
    "postgres://username@localhost:5432/better_database",
  );

  const { databaseConfig } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });
  expect(databaseConfig).toMatchObject({
    kind: "postgres",
    poolConfig: {
      connectionString: "postgres://username@localhost:5432/better_database",
    },
    schema: "public",
  });

  vi.unstubAllEnvs();
});

test("buildConfigAndIndexingFunctions() throws for postgres database with no connection string", async () => {
  const config = createConfig({
    database: { kind: "postgres" },
    networks: { mainnet: { chainId: 1, transport: http() } },
    contracts: { a: { network: "mainnet", abi: [event0] } },
  });

  const prev = process.env.DATABASE_URL;
  // biome-ignore lint/performance/noDelete: Required to test default behavior.
  delete process.env.DATABASE_URL;

  await expect(() =>
    buildConfigAndIndexingFunctions({
      config,
      rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
      options,
    }),
  ).rejects.toThrow(
    "Invalid database configuration: 'kind' is set to 'postgres' but no connection string was provided.",
  );

  process.env.DATABASE_URL = prev;
});

test("buildConfigAndIndexingFunctions() database with postgres uses pool config", async () => {
  const config = createConfig({
    database: {
      kind: "postgres",
      connectionString: "postgres://username@localhost:5432/database",
      poolConfig: { max: 100 },
    },
    networks: { mainnet: { chainId: 1, transport: http() } },
    contracts: { a: { network: "mainnet", abi: [event0] } },
  });

  const { databaseConfig } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });
  expect(databaseConfig).toMatchObject({
    kind: "postgres",
    poolConfig: {
      connectionString: "postgres://username@localhost:5432/database",
      max: 100,
    },
    schema: "public",
  });
});

test("buildConfigAndIndexingFunctions() database with postgres uses RAILWAY_DEPLOYMENT_ID if defined", async () => {
  const config = createConfig({
    networks: { mainnet: { chainId: 1, transport: http() } },
    contracts: { a: { network: "mainnet", abi: [event0] } },
  });

  vi.stubEnv("DATABASE_URL", "postgres://username@localhost:5432/database");
  vi.stubEnv("RAILWAY_DEPLOYMENT_ID", "b39cb9b7-7ef8-4dc4-8035-74344c11c4f2");
  vi.stubEnv("RAILWAY_SERVICE_NAME", "multichain-indexer");

  const { databaseConfig } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
    options,
  });
  expect(databaseConfig).toMatchObject({
    kind: "postgres",
    poolConfig: {
      connectionString: "postgres://username@localhost:5432/database",
    },
    schema: "multichain-indexer_b39cb9b7",
  });

  vi.unstubAllEnvs();
});

test("buildConfigAndIndexingFunctions() database throws with RAILWAY_DEPLOYMENT_ID but no RAILWAY_SERVICE_NAME", async () => {
  const config = createConfig({
    networks: { mainnet: { chainId: 1, transport: http() } },
    contracts: { a: { network: "mainnet", abi: [event0] } },
  });

  vi.stubEnv("DATABASE_URL", "postgres://username@localhost:5432/database");
  vi.stubEnv("RAILWAY_DEPLOYMENT_ID", "b39cb9b7-7ef8-4dc4-8035-74344c11c4f2");

  await expect(() =>
    buildConfigAndIndexingFunctions({
      config,
      rawIndexingFunctions: [{ name: "a:Event0", fn: () => {} }],
      options,
    }),
  ).rejects.toThrow(
    "Invalid database configuration: RAILWAY_DEPLOYMENT_ID env var is defined, but RAILWAY_SERVICE_NAME env var is not.",
  );

  vi.unstubAllEnvs();
});
