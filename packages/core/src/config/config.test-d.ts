import type { Abi, AbiEvent } from "abitype";
import type { ParseAbiItem } from "viem";
import { http } from "viem";
import { assertType, test } from "vitest";

import type {
  FilterAbiEvents,
  Network,
  RecoverAbiEvent,
  SafeEventNames,
} from "./config.js";
import { createConfig } from "./config.js";

type Event0 = ParseAbiItem<"event Event0(bytes32 indexed arg)">;
type Event1 = ParseAbiItem<"event Event1()">;
type Event1Overloaded = ParseAbiItem<"event Event1(bytes32 indexed)">;
type Func = ParseAbiItem<"function func()">;

test("FilterAbiEvents", () => {
  type t = FilterAbiEvents<[Event0, Func]>;
  //   ^?

  assertType<t>([] as unknown as [Event0]);
});

test("SafeEventNames", () => {
  type a = SafeEventNames<
    // ^?
    [Event0, Event1]
  >;
  assertType<a>(["Event0", "Event1"] as const);
});

test("SafeEventNames overloaded", () => {
  type a = SafeEventNames<
    // ^?
    [Event1, Event1Overloaded]
  >;
  assertType<a>(["Event1()", "Event1(bytes32 indexed)"] as const);
});

test("RecoverAbiEvent", () => {
  type a = RecoverAbiEvent<
    // ^?
    [Event0, Event1],
    "Event0"
  >;

  assertType<a>({} as Event0);
});

test("createConfig() network", () => {
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
      c: {
        network: { mainnet: {} },
        abi: [],
      },
    },
  });

  assertType<typeof config.contracts.c.network>({
    mainnet: {},
  });
  assertType<typeof config.networks>(
    {} as {
      mainnet: { chainId: 1; transport: any };
      optimism: { chainId: 10; transport: any };
    },
  );
});

test("createConfig() network shortcut", () => {
  const config = createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http("http://127.0.0.1:8545"),
      },
    },
    contracts: {
      c: {
        network: "mainnet",
        abi: [],
      },
    },
  });

  assertType<typeof config.contracts.c.network>("" as "mainnet");
});

test("createConfig() network weak type", () => {
  const config = createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http("http://127.0.0.1:8545"),
      },
    } as Record<string, Network>,
    contracts: {
      c: {
        network: "mainnet",
        abi: [],
      },
    },
  });

  assertType<keyof typeof config.networks>("" as string);
});

test("createConfig() abi weak type", () => {
  createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http("http://127.0.0.1:8545"),
      },
    } as Record<string, Network>,
    contracts: {
      c: {
        network: "mainnet",
        abi: [] as Abi,
        filter: {
          event: "Event0",
          args: { arg: ["0x0"] },
        },
      },
    },
  });
});

test("createConfig() factory event weak type", () => {
  createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http("http://127.0.0.1:8545"),
      },
    } as Record<string, Network>,
    contracts: {
      c: {
        network: "mainnet",
        abi: [] as Abi,
        factory: {
          address: "0x1",
          event: {} as AbiEvent,
          parameter: "rg",
        },
      },
    },
  });
});

test("createConfig() events", () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      c: {
        network: "mainnet",
        abi: [] as unknown as [Event0, Event1],
        filter: {
          event: ["Event0", "Event1"],
        },
      },
    },
  });

  assertType<typeof config.contracts.c.filter.event>(
    [] as unknown as ["Event0", "Event1"],
  );
});

test("createConfig() has strict arg types for event", () => {
  createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      c: {
        network: "mainnet",
        abi: [] as unknown as [Event0],
        filter: {
          event: "Event0",
          args: { arg: ["0x0"] },
        },
      },
    },
  });
});

test("createConfig() filter with unnamed parameters", () => {
  createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      c: {
        network: "mainnet",
        abi: [] as unknown as [Event1Overloaded],
        filter: {
          event: "Event1",
          args: ["0x0"],
        },
      },
    },
  });
});

test("createConfig() factory", () => {
  const config = createConfig({
    networks: {
      mainnet: { chainId: 1, transport: http("http://127.0.0.1:8545") },
    },
    contracts: {
      c: {
        network: "mainnet",
        abi: [],
        factory: {
          address: "0x1",
          event: {} as Event0,
          parameter: "arg",
        },
      },
    },
  });

  assertType<typeof config.contracts.c.factory>(
    {} as { address: "0x1"; event: Event0; parameter: "arg" },
  );
});
