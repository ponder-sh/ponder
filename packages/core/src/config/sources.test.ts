import { getEventSelector, http, parseAbiItem } from "viem";
import { expect, test } from "vitest";

import { createConfig } from "./config.js";
import { buildSources } from "./sources.js";

const event0 = parseAbiItem("event Event0(bytes32 indexed arg)");
const event1 = parseAbiItem("event Event1()");
const event1Overloaded = parseAbiItem("event Event1(bytes32)");

const address1 = "0x0000000000000000000000000000000000000001";
const bytes1 =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

test("buildSources() builds topics for multiple events", () => {
  const config = createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http("http://127.0.0.1:8545"),
      },
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

  const sources = buildSources({ config });

  expect(sources[0].criteria.topics).toMatchObject([
    [getEventSelector(event0), getEventSelector(event1)],
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
        abi: [event1, event1Overloaded],
        filter: {
          event: ["Event1()", "Event1(bytes32)"],
        },
        address: address1,
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    },
  });

  const sources = buildSources({ config });

  expect(sources[0].criteria.topics).toMatchObject([
    [getEventSelector(event1), getEventSelector(event1Overloaded)],
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
        abi: [event0],
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

  const sources = buildSources({ config });

  expect(sources[0].criteria.topics).toMatchObject([
    getEventSelector(event0),
    bytes1,
    null,
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
      a: {
        network: {
          mainnet: {
            address: address1,
          },
        },
        abi: [event0],
        filter: { event: ["Event0"] },
        address: address1,
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    },
  });

  const sources = buildSources({ config });

  expect(sources[0].criteria.address).toBe(address1);
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

  const sources = buildSources({ config });

  expect(sources[0].networkName).toBe("mainnet");
});
