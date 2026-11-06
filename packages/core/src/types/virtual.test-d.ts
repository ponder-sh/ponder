import { expectTypeOf, test } from "bun:test";
import { type Abi, type Address, type Hex, parseAbiItem } from "viem";
import { createConfig } from "@/config/index.js";
import { onchainTable } from "@/drizzle/onchain.js";
import type { Db } from "./db.js";
import type {
  Block,
  Log,
  Trace,
  Transaction,
  TransactionReceipt,
} from "./eth.js";
import type { Virtual } from "./virtual.js";

const event0 = parseAbiItem(
  "event Event0(bytes32 indexed arg, bytes32 indexed arg1)",
);
const event1 = parseAbiItem("event Event1()");
const event1Overloaded = parseAbiItem("event Event1(bytes32)");
const func0 = parseAbiItem(
  "function func0(address) external returns (uint256)",
);
const func1 = parseAbiItem("function func1()");
const func1Overloaded = parseAbiItem("function func1(bytes32)");

type Event0 = typeof event0;
type Event1 = typeof event1;
type Event1Overloaded = typeof event1Overloaded;
type Func0 = typeof func0;
type Func1 = typeof func1;
type Func1Overloaded = typeof func1Overloaded;

type abi = readonly [
  Event0,
  Event1,
  Event1Overloaded,
  Func0,
  Func1,
  Func1Overloaded,
];

const config = createConfig({
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
      abi: [event0, func0],
      chain: "mainnet",
      address: "0x",
      startBlock: 0,
      includeTransactionReceipts: false,
      includeCallTraces: true,
    },
    c2: {
      abi: [event1, event1Overloaded, func1, func1Overloaded],
      address: "0x69",
      chain: {
        mainnet: {
          startBlock: 1,
          includeTransactionReceipts: true,
          includeCallTraces: true,
        },
        optimism: {},
      },
    },
  },
  accounts: {
    a1: {
      address: "0x",
      chain: "mainnet",
    },
  },
  blocks: {
    b1: {
      interval: 2,
      startBlock: 1,
      chain: "mainnet",
    },
  },
});

const account = onchainTable("account", (p) => ({
  address: p.hex().primaryKey(),
  balance: p.bigint().notNull(),
}));

const schema = { account };

test("FormatEventNames", () => {
  type a = Virtual.FormatEventNames<
    // ^?
    {
      contract: { abi: abi; chain: "" };
    },
    {},
    {}
  >;

  type eventNames =
    | "contract:setup"
    | "contract:Event0"
    | "contract:Event1()"
    | "contract:Event1(bytes32)";

  expectTypeOf<eventNames>().toExtend<a>();
  expectTypeOf<a>().toExtend<eventNames>();
});

test("FormatEventNames with semi-weak abi", () => {
  type a = Virtual.FormatEventNames<
    // ^?
    {
      contract: { abi: abi[number][]; chain: "" };
    },
    {},
    {}
  >;

  type eventNames =
    | "contract:setup"
    | "contract:Event0"
    | "contract:Event1()"
    | "contract:Event1(bytes32)";

  expectTypeOf<eventNames>().toExtend<a>();
  expectTypeOf<a>().toExtend<eventNames>();
});

test("FormatEventNames with weak abi", () => {
  type a = Virtual.FormatEventNames<
    // ^?
    {
      contract: { abi: Abi; chain: "" };
    },
    {},
    {}
  >;

  expectTypeOf<"contract:setup">().toExtend<a>();
  expectTypeOf<a>().toExtend<"contract:setup">();
});

test("FormatEventNames with functions", () => {
  type a = Virtual.FormatEventNames<
    // ^?
    {
      contract: { abi: abi; chain: ""; includeCallTraces: true };
    },
    {},
    {}
  >;

  type eventNames =
    | "contract:setup"
    | "contract:Event0"
    | "contract:Event1()"
    | "contract:Event1(bytes32)"
    | "contract.func0()"
    | "contract.func1()"
    | "contract.func1(bytes32)";

  expectTypeOf<eventNames>().toExtend<a>();
  expectTypeOf<a>().toExtend<eventNames>();
});

test("FormatEventName with accounts", () => {
  type a = Virtual.FormatEventNames<
    // ^?
    {},
    { account: { address: "0x"; chain: "mainnet" } },
    {}
  >;

  expectTypeOf(
    {} as any as
      | "account:transfer:from"
      | "account:transfer:to"
      | "account:transaction:from"
      | "account:transaction:to",
  ).toExtend<a>();
  expectTypeOf<a>().toExtend<
    | "account:transfer:from"
    | "account:transfer:to"
    | "account:transaction:from"
    | "account:transaction:to"
  >();
});

test("FormatEventName with blocks", () => {
  type a = Virtual.FormatEventNames<
    // ^?
    {},
    {},
    { block: { interval: 2; startBlock: 1; chain: "mainnet" } }
  >;

  expectTypeOf<"block:block">().toExtend<a>();
  expectTypeOf<a>().toExtend<"block:block">();
});

test("Context db", () => {
  type a = Virtual.Context<typeof config, typeof schema, "c1:Event0">["db"];
  //   ^?

  expectTypeOf<Db<typeof schema>>().toExtend<a>();
  expectTypeOf<a>().toExtend<Db<typeof schema>>();
});

test("Context single chain", () => {
  type a = Virtual.Context<typeof config, typeof schema, "c1:Event0">["chain"];
  //   ^?

  type expectedChain = { name: "mainnet"; id: 1 };

  expectTypeOf<expectedChain>().toExtend<a>();
  expectTypeOf<a>().toExtend<expectedChain>();
});

test("Context multi chain", () => {
  type a = Virtual.Context<
    typeof config,
    typeof schema,
    "c2:Event1()"
  >["chain"];
  //   ^?

  type expectedChain =
    | { name: "mainnet"; id: 1 }
    | { name: "optimism"; id: 10 };

  expectTypeOf<expectedChain>().toExtend<a>();
  expectTypeOf<a>().toExtend<expectedChain>();
});

test("Context block chain", () => {
  type a = Virtual.Context<typeof config, typeof schema, "b1:block">["chain"];
  //   ^?

  type expectedChain = { name: "mainnet"; id: 1 };

  expectTypeOf<expectedChain>().toExtend<a>();
  expectTypeOf<a>().toExtend<expectedChain>();
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
    | "getCode"
    | "getBalance"
    | "getEnsName";

  expectTypeOf<expectedFunctions>().toExtend<keyof a>();
});

test("Context contracts", () => {
  type a = Virtual.Context<
    typeof config,
    typeof schema,
    "c2:Event1()"
  >["contracts"]["c2"];
  //   ^?

  type expectedAbi = [Event1, Event1Overloaded, Func1, Func1Overloaded];
  type expectedStartBlock = 1 | undefined;
  type expectedEndBlock = undefined;
  type expectedAddress = "0x69";

  expectTypeOf<expectedAbi>().toExtend<a["abi"]>();
  expectTypeOf<a["abi"]>().toExtend<expectedAbi>();

  expectTypeOf<expectedStartBlock>().toExtend<a["startBlock"]>();
  expectTypeOf<a["startBlock"]>().toExtend<expectedStartBlock>();

  expectTypeOf<expectedEndBlock>().toExtend<a["endBlock"]>();
  expectTypeOf<a["endBlock"]>().toExtend<expectedEndBlock>();

  expectTypeOf<expectedAddress>().toExtend<a["address"]>();
  expectTypeOf<a["address"]>().toExtend<expectedAddress>();
});

test("Context chain without event", () => {
  type a = Virtual.Context<
    // ^?
    typeof config,
    typeof schema,
    Virtual.EventNames<typeof config>
  >["chain"];

  type expectedChain =
    | {
        name: "mainnet";
        id: 1;
      }
    | {
        name: "optimism";
        id: 10;
      };

  expectTypeOf<expectedChain>().toExtend<a>();
  expectTypeOf<a>().toExtend<expectedChain>();
});

test("Event", () => {
  type a = Virtual.Event<typeof config, "c1:Event0">;
  //   ^?

  type expectedEvent = {
    id: string;
    args: {
      arg: Hex;
      arg1: Hex;
    };
    log: Log;
    block: Block;
    transaction: Transaction;
  };

  expectTypeOf<expectedEvent>().toExtend<a>();
  expectTypeOf<a>().toExtend<expectedEvent>();
});

test("Event transaction receipt", () => {
  type a = Virtual.Event<typeof config, "c2:Event1()">;
  //   ^?

  type expectedEvent = {
    id: string;
    args: readonly [];
    log: Log;
    block: Block;
    transaction: Transaction;
    transactionReceipt?: TransactionReceipt;
  };

  expectTypeOf<expectedEvent>().toExtend<a>();
  expectTypeOf<a>().toExtend<expectedEvent>();
});

test("Event with unnamed parameters", () => {
  type a = Virtual.Event<typeof config, "c2:Event1(bytes32)">;
  //   ^?

  type expectedEvent = {
    id: string;
    args: readonly [Hex];
    log: Log;
    block: Block;
    transaction: Transaction;
  };

  expectTypeOf<expectedEvent>().toExtend<a>();
  expectTypeOf<a>().toExtend<expectedEvent>();
});

test("Event with functions", () => {
  type a = Virtual.Event<typeof config, "c1.func0()">;
  //   ^?

  type expectedEvent = {
    id: string;
    args: readonly [Address];
    result: bigint;
    trace: Trace;
    block: Block;
    transaction: Transaction;
  };

  expectTypeOf<expectedEvent>().toExtend<a>();
  expectTypeOf<a>().toExtend<expectedEvent>();
});

test("Event with functions and no inputs or outputs", () => {
  type a = Virtual.Event<typeof config, "c2.func1()">;
  //   ^?

  type expectedEvent = {
    id: string;
    args: never;
    result: never;
    trace: Trace;
    block: Block;
    transaction: Transaction;
  };

  expectTypeOf<expectedEvent>().toExtend<a>();
  expectTypeOf<a>().toExtend<expectedEvent>();
});

test("Event with account transaction", () => {
  type a = Virtual.Event<typeof config, "a1:transaction:from">;
  //   ^?

  type expectedEvent = {
    id: string;
    block: Block;
    transaction: Transaction;
    transactionReceipt: TransactionReceipt;
  };

  expectTypeOf<expectedEvent>().toExtend<a>();
  expectTypeOf<a>().toExtend<expectedEvent>();
});

test("Event with account transfer", () => {
  type a = Virtual.Event<typeof config, "a1:transfer:from">;
  //   ^?

  type expectedEvent = {
    id: string;
    transfer: {
      from: Address;
      to: Address;
      value: bigint;
    };
    block: Block;
    transaction: Transaction;
    trace: Trace;
  };

  expectTypeOf<expectedEvent>().toExtend<a>();
  expectTypeOf<a>().toExtend<expectedEvent>();
});

test("Event with block", () => {
  type a = Virtual.Event<typeof config, "b1:block">;
  //   ^?

  type expectedEvent = {
    id: string;
    block: Block;
  };

  expectTypeOf<expectedEvent>().toExtend<a>();
  expectTypeOf<a>().toExtend<expectedEvent>();
});

test("Registry", () => {
  const ponder = {} as any as Virtual.Registry<typeof config, typeof schema>;

  ponder.on("c1:Event0", async ({ event, context }) => {
    event.id;
    event.args;
    event.log;
    event.block;
    event.transaction;

    context.chain;
    context.db;
    context.client;
    context.contracts.c1;
    context.contracts.c2;
  });
});
