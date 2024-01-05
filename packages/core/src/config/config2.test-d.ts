import { http, type Abi, parseAbiItem } from "viem";
import { test } from "vitest";
import { createConfig } from "./config2.js";

const event0 = parseAbiItem("event Event0(bytes32 indexed arg)");
const event1 = parseAbiItem("event Event1()");
const func = parseAbiItem("function func()");

test("createConfig basic", () => {
  createConfig({
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
        abi: [event1],
        network: "mainnet",
        // ^?
        startBlock: 0,
        // ^?
      },
    },
  });
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

test("createConfig address", () => {
  createConfig({
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
        abi: [event1],
        network: "mainnet",
        // ^?
        startBlock: 0,
        address: "0x1",
      },
    },
  });
});

test("createConfig factory", () => {
  createConfig({
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
        abi: [event1],
        network: "mainnet",
        // ^?
        startBlock: 0,
        factory: {
          address: "0x",
          event: event0,
          parameter: "arg",
        },
      },
    },
  });
});

test("createConfig address and factory", () => {
  createConfig({
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
        abi: [event1],
        network: "mainnet",
        // ^?
        startBlock: 0,
        factory: {
          address: "0x",
          event: event0,
          parameter: "arg",
        },
        // @ts-expect-error
        address: "0x",
      },
    },
  });
});

test("createConfig filter", () => {
  createConfig({
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
        abi: [event1],
        network: "mainnet",
        // ^?
        filter: {
          event: "",
        },
      },
    },
  });
});
test("createConfig filter multiple events", () => {});
test("createConfig filter with args", () => {});

test("createConfig network overrides", () => {});

test("createConfig weak Abi", () => {
  const abi = [event0, func] as Abi;

  createConfig({
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
        abi,
        network: "mainnet",
      },
    },
  });
});
