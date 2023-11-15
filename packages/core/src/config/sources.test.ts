import { http } from "viem";
import { expect, test } from "vitest";

import { createConfig } from "./config.js";
import { abiSimple, abiWithSameEvent } from "./config.test-d.js";
import { buildSources } from "./sources.js";

test("buildSources() builds topics for multiple events", () => {
  const config = createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http("http://127.0.0.1:8545"),
      },
    },
    contracts: {
      BaseRegistrarImplementation: {
        network: { mainnet: {} },
        abi: abiSimple,
        filter: { event: ["Transfer", "Approve"] },
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    },
  });

  const sources = buildSources({ config });

  expect(sources[0].criteria.topics).toMatchObject([
    [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x6e11fb1b7f119e3f2fa29896ef5fdf8b8a2d0d4df6fe90ba8668e7d8b2ffa25e",
    ],
    null,
    null,
    null,
  ]);
});

test("buildSources() for duplicate event", () => {
  const config = createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http("http://127.0.0.1:8545"),
      },
    },
    contracts: {
      BaseRegistrartImplementation: {
        network: { mainnet: {} },
        abi: abiWithSameEvent,
        filter: {
          event: [
            "Approve(address indexed from, address indexed to, uint256 amount)",
            "Approve(address indexed, bytes32 indexed, uint256)",
          ],
        },
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    },
  });

  const sources = buildSources({ config });

  expect(sources[0].criteria.topics).toMatchObject([
    [
      "0x6e11fb1b7f119e3f2fa29896ef5fdf8b8a2d0d4df6fe90ba8668e7d8b2ffa25e",
      "0xdbb5081f3bcbc60be144528482d176e8141b95ebe19a2ab38100455dc726eaa6",
    ],
    null,
    null,
    null,
  ]);
});

test("buildSources() multichain", () => {
  const config = createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http("http://127.0.0.1:8545"),
      },
      optimism: {
        chainId: 10,
        transport: http("http://127.0.0.1:8545"),
      },
    },
    contracts: {
      a: {
        network: { mainnet: {}, optimism: {} },
        abi: abiSimple,
      },
    },
  });

  const sources = buildSources({ config });

  expect(sources.length).toBe(2);
});

test("buildSources() builds topics for event with args", () => {
  const config = createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http("http://127.0.0.1:8545"),
      },
    },
    contracts: {
      BaseRegistrarImplmentation: {
        network: { mainnet: {} },
        abi: abiSimple,
        filter: {
          event: "Approve",
          args: {
            to: "0xF39d15cB3910d5e33fb1a2E42D4a2da153Ba076B",
          },
        },
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    },
  });

  const sources = buildSources({ config });

  expect(sources[0].criteria.topics).toMatchObject([
    "0x6e11fb1b7f119e3f2fa29896ef5fdf8b8a2d0d4df6fe90ba8668e7d8b2ffa25e",
    null,
    "0x000000000000000000000000f39d15cb3910d5e33fb1a2e42d4a2da153ba076b",
    null,
  ]);
});

test("buildSources() overrides default values with network values", () => {
  const config = createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http("http://127.0.0.1:8545"),
      },
    },
    contracts: {
      BaseRegistrarImplementation: {
        network: {
          mainnet: {
            address: "0xF39d15cB3910d5e33fb1a2E42D4a2da153Ba076B",
          },
        },
        abi: abiSimple,
        filter: { event: ["Transfer"] },
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    },
  });

  const sources = buildSources({ config });

  expect(sources[0].criteria.address).toBe(
    "0xf39d15cb3910d5e33fb1a2e42d4a2da153ba076b",
  );
});

test("buildSources() network shortcut", () => {
  const config = createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http("http://127.0.0.1:8545"),
      },
    },
    contracts: {
      BaseRegistrarImplementation: {
        network: "mainnet",
        abi: abiSimple,
        filter: { event: ["Transfer"] },
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    },
  });

  const sources = buildSources({ config });

  expect(sources[0].networkName).toBe("mainnet");
});
