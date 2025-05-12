import { type Abi, parseAbiItem } from "viem";
import { assertType, test } from "vitest";
import { factory } from "./address.js";
import { createConfig } from "./index.js";

const event0 = parseAbiItem(
  "event Event0(bytes32 indexed arg, bytes32 indexed arg1)",
);
const event1 = parseAbiItem("event Event1()");
const func = parseAbiItem("function func()");

test("createConfig basic", () => {
  createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: "https://rpc.com",
      },
      optimism: {
        id: 10,
        rpc: "https://rpc.com",
      },
    },
    contracts: {
      c1: {
        abi: [event1],
        chain: "mainnet",
        startBlock: 0,
      },
      c2: {
        abi: [event1],
        chain: "optimism",
        startBlock: 0,
      },
    },
  });
});

test("createConfig no extra properties", () => {
  createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: "https://rpc.com",
        // @ts-expect-error
        a: 0,
      },
    },
    contracts: {
      c2: {
        abi: [event0],
        chain: "mainnet",
        // @ts-expect-error
        a: 0,
      },
    },
  });
});

test("createConfig address", () => {
  createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: "https://rpc.com",
      },
      optimism: {
        id: 10,
        rpc: "https://rpc.com",
      },
    },
    contracts: {
      c2: {
        abi: [event1],
        chain: "mainnet",
        address: "0x1",
      },
    },
  });
});

test("createConfig factory", () => {
  createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: "https://rpc.com",
      },
      optimism: {
        id: 10,
        rpc: "https://rpc.com",
      },
    },
    contracts: {
      c2: {
        abi: [event1],
        chain: "mainnet",
        address: factory({
          address: "0x",
          event: event0,
          parameter: "arg",
        }),
      },
    },
  });
});

test("createConfig with filter", () => {
  createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: "https://rpc.com",
      },
      optimism: {
        id: 10,
        rpc: "https://rpc.com",
      },
    },
    contracts: {
      c2: {
        abi: [event0, event1],
        chain: "mainnet",
        filter: {
          event: "Event0",
          //^?
          args: {
            arg: ["0x"],
            //^?
          },
        },
      },
    },
  });
});

test("createConfig with multiple filters", () => {
  createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: "https://rpc.com",
      },
      optimism: {
        id: 10,
        rpc: "https://rpc.com",
      },
    },
    contracts: {
      c2: {
        abi: [event0, event1],
        chain: "mainnet",
        filter: [
          {
            event: "Event0",
            //^?
            args: {
              arg: ["0x"],
              //^?
            },
          },
          {
            event: "Event1",
            args: [],
          },
        ],
      },
    },
  });
});

test("createConfig chain overrides", () => {
  createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: "https://rpc.com",
      },
      optimism: {
        id: 10,
        rpc: "https://rpc.com",
      },
    },
    contracts: {
      c1: {
        abi: [event1],
        chain: "mainnet",
        startBlock: 0,
      },
      c2: {
        abi: [event0, event1],
        chain: {
          optimism: {
            address: "0x",
            filter: {
              event: "Event0",
              args: {
                arg: ["0x"],
              },
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
    chains: {
      mainnet: {
        id: 1,
        rpc: "https://rpc.com",
      },
      optimism: {
        id: 10,
        rpc: "https://rpc.com",
      },
    },
    contracts: {
      c2: {
        abi,
        chain: "mainnet",
        filter: {
          event: "event0",
          //^?
          args: {},
          //^?
        },
      },
    },
  });
});

test("createConfig strict return type", () => {
  const config = createConfig({
    //  ^?
    chains: {
      mainnet: {
        id: 1,
        rpc: "https://rpc.com",
      },
      optimism: {
        id: 10,
        rpc: "https://rpc.com",
      },
    },
    contracts: {
      c2: {
        abi: [event0, event1],
        chain: "mainnet",
        filter: {
          event: "Event0",
          args: {
            arg: ["0x"],
          },
        },
      },
    },
  });

  assertType<{ mainnet: { id: 1; rpc: string } }>(config.chains);
  assertType<{
    c2: {
      abi: readonly [typeof event0, typeof event1];
      chain: "mainnet";
      filter: {
        event: "Event0";
        args: {
          arg: ["0x"];
        };
      };
    };
  }>(config.contracts);
});

test("createConfig accounts", () => {
  createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: "https://rpc.com",
      },
      optimism: {
        id: 10,
        rpc: "https://rpc.com",
      },
    },
    accounts: {
      me: {
        chain: "mainnet",
        address: ["0x"],
      },
    },
  });
});
