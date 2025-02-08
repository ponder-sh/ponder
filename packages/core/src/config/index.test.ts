import { http, type Abi, type HttpTransport, parseAbiItem } from "viem";
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
        abi: [event0, event1],
        network: "mainnet",
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
        abi: [event0, event1],
        network: "mainnet",
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

test("createConfig network overrides", () => {
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
      c1: {
        abi: [event1],
        network: "mainnet",
        startBlock: 0,
      },
      c2: {
        abi: [event0, event1],
        network: {
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

  assertType<{ mainnet: { chainId: 1; transport: HttpTransport } }>(
    config.networks,
  );
  assertType<{
    c2: {
      abi: readonly [typeof event0, typeof event1];
      network: "mainnet";
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
    accounts: {
      me: {
        network: "mainnet",
        address: ["0x"],
      },
    },
  });
});
