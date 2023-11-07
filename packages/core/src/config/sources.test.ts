import { http } from "viem";
import { expect, test } from "vitest";

import { Config, createConfig } from "./config";
import { abiSimple, abiWithSameEvent } from "./config.test-d";
import { buildSources } from "./sources";

test("buildSources() builds topics for multiple events", () => {
  const sources = buildSources({
    config: createConfig({
      networks: [
        {
          name: "mainnet",
          chainId: 1,
          transport: http("http://127.0.0.1:8545"),
        },
      ],
      contracts: [
        {
          name: "BaseRegistrarImplementation",
          network: [{ name: "mainnet" }],
          abi: abiSimple,
          filter: { event: ["Transfer", "Approve"] },
          address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
          startBlock: 16370000,
          endBlock: 16370020,
          maxBlockRange: 10,
        },
      ],
    }) as unknown as Config,
  });

  expect(sources[0].criteria.topics).toMatchObject([
    [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x6e11fb1b7f119e3f2fa29896ef5fdf8b8a2d0d4df6fe90ba8668e7d8b2ffa25e",
    ],
  ]);
});

test("buildSources() for duplicate event", () => {
  const sources = buildSources({
    config: createConfig({
      networks: [
        {
          name: "mainnet",
          chainId: 1,
          transport: http("http://127.0.0.1:8545"),
        },
      ],
      contracts: [
        {
          name: "BaseRegistrarImplementation",
          network: [{ name: "mainnet" }],
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
      ],
    }) as unknown as Config,
  });

  expect(sources[0].criteria.topics).toMatchObject([
    [
      "0x6e11fb1b7f119e3f2fa29896ef5fdf8b8a2d0d4df6fe90ba8668e7d8b2ffa25e",
      "0xdbb5081f3bcbc60be144528482d176e8141b95ebe19a2ab38100455dc726eaa6",
    ],
  ]);
});

test("buildSources() builds topics for event with args", () => {
  const sources = buildSources({
    config: createConfig({
      networks: [
        {
          name: "mainnet",
          chainId: 1,
          transport: http("http://127.0.0.1:8545"),
        },
      ],
      contracts: [
        {
          name: "BaseRegistrarImplementation",
          network: [{ name: "mainnet" }],
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
      ],
    }) as unknown as Config,
  });

  expect(sources[0].criteria.topics).toMatchObject([
    "0x6e11fb1b7f119e3f2fa29896ef5fdf8b8a2d0d4df6fe90ba8668e7d8b2ffa25e",
    null,
    "0x000000000000000000000000f39d15cb3910d5e33fb1a2e42d4a2da153ba076b",
  ]);
});

test("buildSources() overrides default values with network values", () => {
  const sources = buildSources({
    config: createConfig({
      networks: [
        {
          name: "mainnet",
          chainId: 1,
          transport: http("http://127.0.0.1:8545"),
        },
      ],
      contracts: [
        {
          name: "BaseRegistrarImplementation",
          network: [
            {
              name: "mainnet",
              address: "0xF39d15cB3910d5e33fb1a2E42D4a2da153Ba076B",
            },
          ],
          abi: abiSimple,
          filter: { event: ["Transfer"] },
          address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
          startBlock: 16370000,
          endBlock: 16370020,
          maxBlockRange: 10,
        },
      ],
    }) as unknown as Config,
  });

  expect(sources[0].criteria.address).toBe(
    "0xf39d15cb3910d5e33fb1a2e42d4a2da153ba076b"
  );
});
