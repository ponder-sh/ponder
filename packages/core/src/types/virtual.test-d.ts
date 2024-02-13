import { createConfig } from "@/config/config.js";
import { createSchema, createTable } from "@/schema/schema.js";
import { http, type Abi, type Hex, parseAbiItem } from "viem";
import { assertType, test } from "vitest";
import type { Block, Log, Transaction } from "./eth.js";
import type { DatabaseModel } from "./model.js";
import type { Virtual } from "./virtual.js";

const event0 = parseAbiItem(
  "event Event0(bytes32 indexed arg, bytes32 indexed arg1)",
);
const event1 = parseAbiItem("event Event1()");
const event1Overloaded = parseAbiItem("event Event1(bytes32)");
const func = parseAbiItem("function func()");

type Event0 = typeof event0;
type Event1 = typeof event1;
type Event1Overloaded = typeof event1Overloaded;
type Func = typeof func;

type abi = readonly [Event0, Event1, Event1Overloaded, Func];

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
    c1: {
      abi: [event0, func],
      network: "mainnet",
      address: "0x",
      startBlock: 0,
    },
    c2: {
      abi: [event1, event1Overloaded],
      address: "0x69",
      network: {
        mainnet: {
          startBlock: 1,
        },
        optimism: {},
      },
    },
  },
});

const schema = createSchema((p) => ({
  table: createTable({
    id: p.string(),
  }),
}));

test("FormatEventNames without filter", () => {
  type a = Virtual.FormatEventNames<{
    // ^?
    contract: { abi: abi; network: "" };
  }>;

  type eventNames =
    | "contract:setup"
    | "contract:Event0"
    | "contract:Event1()"
    | "contract:Event1(bytes32)";

  assertType<a>({} as any as eventNames);
  assertType<eventNames>({} as any as a);
});

test("FormatEvent names with filter", () => {
  type a = Virtual.FormatEventNames<{
    // ^?
    contract: { abi: abi; network: ""; filter: { event: "Event1()" } };
  }>;

  type eventNames = "contract:setup" | "contract:Event1()";

  assertType<a>({} as any as eventNames);
  assertType<eventNames>({} as any as a);
});

test("FormatEvent names with filter array", () => {
  type a = Virtual.FormatEventNames<{
    // ^?
    contract: {
      abi: abi;
      network: "";
      filter: { event: readonly ["Event1()"] };
    };
  }>;

  type eventNames = "contract:setup" | "contract:Event1()";

  assertType<a>({} as any as eventNames);
  assertType<eventNames>({} as any as a);
});

test("FormatEventNames with semi-weak abi", () => {
  type a = Virtual.FormatEventNames<{
    // ^?
    contract: { abi: abi[number][]; network: "" };
  }>;

  type eventNames =
    | "contract:setup"
    | "contract:Event0"
    | "contract:Event1()"
    | "contract:Event1(bytes32)";

  assertType<a>({} as any as eventNames);
  assertType<eventNames>({} as any as a);
});

test("FormatEventNames with weak abi", () => {
  type a = Virtual.FormatEventNames<{
    // ^?
    contract: { abi: Abi; network: "" };
  }>;

  assertType<a>({} as any as "contract:setup");
  assertType<"contract:setup">({} as any as a);
});

test("Context db", () => {
  type a = Virtual.Context<typeof config, typeof schema, "c1:Event0">["db"];
  //   ^?

  type expectedDB = { table: DatabaseModel<{ id: string }> };

  assertType<a>({} as any as expectedDB);
  assertType<expectedDB>({} as any as a);
});

test("Context single network", () => {
  type a = Virtual.Context<
    typeof config,
    typeof schema,
    "c1:Event0"
  >["network"];
  //   ^?

  type expectedNetwork = { name: "mainnet"; chainId: 1 };

  assertType<a>({} as any as expectedNetwork);
  assertType<expectedNetwork>({} as any as a);
});

test("Context multi network", () => {
  type a = Virtual.Context<
    typeof config,
    typeof schema,
    "c2:Event1()"
  >["network"];
  //   ^?

  type expectedNetwork =
    | { name: "mainnet"; chainId: 1 }
    | { name: "optimism"; chainId: 10 };

  assertType<a>({} as any as expectedNetwork);
  assertType<expectedNetwork>({} as any as a);
});

test("Context client", () => {
  type a = Virtual.Context<
    typeof config,
    typeof schema,
    "c2:Event1()"
  >["client"];
  //   ^?

  type expectedFunctions =
    | "request"
    | "readContract"
    | "multicall"
    | "getStorageAt"
    | "getBytecode"
    | "getBalance";

  assertType<keyof a>({} as any as expectedFunctions);
  assertType<expectedFunctions>({} as any as keyof a);
});

test("Context contracts", () => {
  type a = Virtual.Context<
    typeof config,
    typeof schema,
    "c2:Event1()"
  >["contracts"]["c2"];
  //   ^?

  type expectedAbi = [Event1, Event1Overloaded];
  type expectedStartBlock = 1 | undefined;
  type expectedEndBlock = undefined;
  type expectedAddress = "0x69";

  assertType<a["abi"]>({} as any as expectedAbi);
  assertType<expectedAbi>({} as any as a["abi"]);

  assertType<a["startBlock"]>({} as any as expectedStartBlock);
  assertType<expectedStartBlock>({} as any as a["startBlock"]);

  assertType<a["endBlock"]>({} as any as expectedEndBlock);
  assertType<expectedEndBlock>({} as any as a["endBlock"]);

  assertType<a["address"]>({} as any as expectedAddress);
  assertType<expectedAddress>({} as any as a["address"]);
});

test("Event", () => {
  type a = Virtual.Event<typeof config, "c1:Event0">;
  //   ^?

  type expectedEvent = {
    name: "Event0";
    args: {
      arg: Hex;
      arg1: Hex;
    };
    log: Log;
    block: Block;
    transaction: Transaction;
  };

  assertType<a>({} as any as expectedEvent);
  assertType<expectedEvent>({} as any as a);
});

test("Event with unnamed parameters", () => {
  type a = Virtual.Event<typeof config, "c2:Event1(bytes32)">;
  //   ^?

  type expectedEvent = {
    name: "Event1(bytes32)";
    args: readonly [Hex];
    log: Log;
    block: Block;
    transaction: Transaction;
  };

  assertType<a>({} as any as expectedEvent);
  assertType<expectedEvent>({} as any as a);
});

test("Registry", () => {
  const ponder = {} as any as Virtual.Registry<typeof config, typeof schema>;

  ponder.on("c1:Event0", async ({ event, context }) => {
    event.name;
    event.args;
    event.log;
    event.block;
    event.transaction;

    context.network;
    context.db;
    context.client;
    context.contracts.c1;
    context.contracts.c2;
  });
});
