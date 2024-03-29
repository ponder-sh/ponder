import { http, type Abi, type HttpTransport, parseAbiItem } from "viem";
import { mainnet, optimism } from "viem/chains";
import { assertType, test } from "vitest";
import { createConfig } from "./config.js";

const event0 = parseAbiItem(
  "event Event0(bytes32 indexed arg, bytes32 indexed arg1)",
);
const event1 = parseAbiItem("event Event1()");
const func = parseAbiItem("function func()");

test("createConfig basic", () => {
  createConfig({
    networks: {
      mainnet: {
        chain: mainnet,
        transport: http(),
      },
      optimism: {
        chain: optimism,
        transport: http(),
      },
    },
    contracts: {
      c1: {
        abi: [event1],
        network: "mainnet",
        startBlock: 0,
      },
      c2: {
        abi: [event1],
        network: "optimism",
        startBlock: 0,
      },
    },
  });
});

test("createConfig no extra properties", () => {
  createConfig({
    networks: {
      mainnet: {
        chain: mainnet,
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
        chain: mainnet,
        transport: http(),
      },
      optimism: {
        chain: optimism,
        transport: http(),
      },
    },
    contracts: {
      c2: {
        abi: [event1],
        network: "mainnet",
        address: "0x1",
      },
    },
  });
});

test("createConfig factory", () => {
  createConfig({
    networks: {
      mainnet: {
        chain: mainnet,
        transport: http(),
      },
      optimism: {
        chain: optimism,
        transport: http(),
      },
    },
    contracts: {
      c2: {
        abi: [event1],
        network: "mainnet",
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
        chain: mainnet,
        transport: http(),
      },
      optimism: {
        chain: optimism,
        transport: http(),
      },
    },
    contracts: {
      c2: {
        abi: [event1],
        network: "mainnet",
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
        chain: mainnet,
        transport: http(),
      },
      optimism: {
        chain: optimism,
        transport: http(),
      },
    },
    contracts: {
      c2: {
        abi: [event1],
        network: "mainnet",
        filter: {
          event: "Event1",
        },
      },
    },
  });
});

test("createConfig filter with args", () => {
  createConfig({
    networks: {
      mainnet: {
        chain: mainnet,
        transport: http(),
      },
      optimism: {
        chain: optimism,
        transport: http(),
      },
    },
    contracts: {
      c2: {
        abi: [event0, event1],
        network: "mainnet",
        filter: {
          event: "Event0",
          args: {
            arg: ["0x"],
          },
        },
      },
    },
  });
});

test("createConfig filter multiple events", () => {
  createConfig({
    networks: {
      mainnet: {
        chain: mainnet,
        transport: http(),
      },
      optimism: {
        chain: optimism,
        transport: http(),
      },
    },
    contracts: {
      c2: {
        abi: [event0, event1],
        network: "mainnet",
        filter: {
          event: ["Event0", "Event1"],
        },
      },
    },
  });
});

test("createConfig network overrides", () => {
  createConfig({
    networks: {
      mainnet: {
        chain: mainnet,
        transport: http(),
      },
      optimism: {
        chain: optimism,
        transport: http(),
      },
    },
    contracts: {
      c1: {
        abi: [event1],
        network: "mainnet",
        startBlock: 0,
      },
      c2: {
        abi: [event1],
        network: {
          optimism: {
            address: "0x",
            filter: {
              event: "Event1",
            },
          },
        },
        startBlock: 0,
      },
    },
  });
});

test("createConfig weak Abi", () => {
  const abi = [event0, func] as Abi;

  createConfig({
    networks: {
      mainnet: {
        chain: mainnet,
        transport: http(),
      },
      optimism: {
        chain: optimism,
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

test("createConfig strict return type", () => {
  const config = createConfig({
    //  ^?
    networks: {
      mainnet: {
        chain: mainnet,
        transport: http(),
      },
      optimism: {
        chain: optimism,
        transport: http(),
      },
    },
    contracts: {
      c2: {
        abi: [event0, event1],
        network: "mainnet",
        filter: {
          event: "Event1",
        },
      },
    },
  });

  assertType<{ mainnet: { chain: typeof mainnet; transport: HttpTransport } }>(
    config.networks,
  );
  assertType<{
    c2: {
      abi: readonly [typeof event0, typeof event1];
      network: "mainnet";
      filter: {
        event: "Event1";
      };
    };
  }>(config.contracts);
});
