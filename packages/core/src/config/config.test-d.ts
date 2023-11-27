import type { ParseAbiItem } from "viem";
import { http } from "viem";
import { assertType, test } from "vitest";

import type {
  FilterAbiEvents,
  RecoverAbiEvent,
  SafeEventNames,
} from "./config.js";
import { createConfig } from "./config.js";

type Event0 = ParseAbiItem<"event Event0(bytes32 indexed arg)">;
type Event1 = ParseAbiItem<"event Event1()">;
type Event1Overloaded = ParseAbiItem<"event Event1(bytes32)">;
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
  assertType<a>(["Event1()", "Event1(bytes32)"] as const);
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
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
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
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    },
  });

  assertType<typeof config.contracts.c.network>("" as "mainnet");
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
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    },
  });

  assertType<typeof config.contracts.c.filter.event>(
    [] as unknown as ["Event0", "Event1"],
  );
});

test.skip("createConfig() has strict arg types for event", () => {
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
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    },
  });
});
