import { http, parseAbiItem } from "viem";
import { assertType, test } from "vitest";
import {
  type DatabaseConfig,
  type OptionConfig,
  createConfig,
} from "./config2.js";

const event0 = parseAbiItem("event Event0(bytes32 indexed arg)");
const event1 = parseAbiItem("event Event1()");
const event1Overloaded = parseAbiItem("event Event1(bytes32 indexed)");
const func = parseAbiItem("function func()");

test("createConfig basic", () => {
  const config = createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http(),
      },
      optimism: {
        chainId: 10,
        transport: http(),
      },
    },
    contracts: {
      c2: {
        // ^?
        abi: [event1],
        network: "mainnet",
        // ^?
        startBlock: 0,
      },
    },
  });

  assertType<{
    // networks: { mainnet: NetworkConfig; optimism: NetworkConfig };
    contracts: {
      c1: {
        abi: readonly [typeof event0];
        network: "mainnet";
      };
      c2: { abi: readonly [typeof event1]; network: "mainnet" };
    };
    database?: DatabaseConfig;
    options?: OptionConfig;
  }>({} as unknown as typeof config);
});

test("createConfig no extra properties", () => {
  createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http(),
        // @ts-expect-error
        a: 0,
      },
    },
    contracts: {
      c2: {
        abi: [event0],
        network: "mainnet",
        // @ts-expect-error
        a: 0,
      },
    },
  });
});

test("createConfig address");

test("createConfig factory");

test("createConfig address and factory");

test("createConfig filter", () => {});
test("createConfig filter multiple events", () => {});
test("createConfig filter with args", () => {});

test("createConfig network overrides", () => {});

test("createConfig weak Abi", () => {
  const abi = [event0, func] as readonly unknown[];

  const config = createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http(),
      },
    },
    contracts: {
      c1: {
        abi,
        network: "mainnet",
      },
    },
  });
});
