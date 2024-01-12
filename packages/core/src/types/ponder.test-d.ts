import { createConfig } from "@/index.js";
import type { ReadOnlyClient } from "@/indexing/ponderActions.js";
import { http, type Abi, type Hex, parseAbiItem } from "viem";
import { assertType, test } from "vitest";
import type { PonderApp, PonderEventNames } from "./ponder.js";

const event0 = parseAbiItem(
  "event Event0(bytes32 indexed arg, bytes32 indexed arg1)",
);
const event1 = parseAbiItem("event Event1()");
const event1Overloaded = parseAbiItem("event Event1(bytes32)");
const func = parseAbiItem("function func()");

type Event0 = typeof event0;
type Event1 = typeof event1;
type Event1Overloaded = typeof event1Overloaded;
// type Func = typeof func;

const baseConfig = createConfig({
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
      startBlock: 0,
    },
    c2: {
      abi: [event1, event1Overloaded],
      network: "optimism",
      startBlock: 0,
    },
  },
});

test("EventNames without filter", () => {
  type t = PonderEventNames<typeof baseConfig>;
  //   ^?

  assertType<t>(
    {} as any as
      | "c1:Event0"
      | "c1:setup"
      | "c2:Event1()"
      | "c2:Event1(bytes32)"
      | "c2:setup",
  );
  assertType<
    "c1:Event0" | "c1:setup" | "c2:Event1()" | "c2:Event1(bytes32)" | "c2:setup"
  >({} as any as t);
});

test("EventNames with single filter", () => {
  const config = createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http(),
      },
    },
    contracts: {
      c1: {
        abi: [event0, event1, func],
        network: "mainnet",
        startBlock: 0,
        filter: {
          event: "Event0",
        },
      },
    },
  });

  type t = PonderEventNames<typeof config>;
  //   ^?

  assertType<t>({} as any as "c1:Event0" | "c1:setup");
  assertType<"c1:Event0" | "c1:setup">({} as any as t);
});

test("EventNames with event array", () => {
  const config = createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http(),
      },
    },
    contracts: {
      c1: {
        abi: [event0, event1, func],
        network: "mainnet",
        startBlock: 0,
        filter: {
          event: ["Event0"],
        },
      },
    },
  });

  type t = PonderEventNames<typeof config>;
  //   ^?

  assertType<t>({} as any as "c1:Event0" | "c1:setup");
  assertType<"c1:Event0" | "c1:setup">({} as any as t);
});

test("EventNames with semi-weak abi", () => {
  const config = createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http(),
      },
    },
    contracts: {
      c1: {
        abi: [event0, event1, func],
        network: "mainnet",
        startBlock: 0,
        filter: {
          event: ["Event0"],
        },
      },
    },
  });

  type t = PonderEventNames<typeof config>;
  //   ^?

  assertType<t>({} as any as "c1:Event0" | "c1:setup");
  assertType<"c1:Event0" | "c1:setup">({} as any as t);
});

test("PonderApp setup", () => {
  type p = PonderApp<
    // ^?
    {
      networks: {
        mainnet: any;
      };
      contracts: {
        Contract: { network: "mainnet"; abi: Abi };
      };
    },
    any
  >;

  type name = Parameters<p["on"]>[0];
  //   ^?

  assertType<name>("" as "Contract:setup");
});

test("PonderApp event names", () => {
  type p = PonderApp<
    // ^?
    {
      networks: any;
      contracts: {
        Contract: { network: any; abi: [Event1] };
      };
    },
    any
  >;

  type name = Parameters<p["on"]>[0];
  //   ^?

  assertType<name>("" as "Contract:setup" | "Contract:Event1");
});

test("PonderApp event names overloaded", () => {
  type p = PonderApp<
    // ^?
    {
      networks: any;
      contracts: {
        Contract: { network: any; abi: [Event1, Event1Overloaded] };
      };
    },
    any
  >;

  type name = Parameters<p["on"]>[0];
  //   ^?

  assertType<name>(
    "" as "Contract:setup" | "Contract:Event1()" | "Contract:Event1(bytes32)",
  );
});

test("PonderApp multiple contracts", () => {
  type p = PonderApp<
    // ^?
    {
      networks: any;
      contracts: {
        Contract0: { network: any; abi: [Event0] };
        Contract1: { network: any; abi: [Event1] };
      };
    },
    any
  >;

  // Events should only correspond to their contract
  type name = Exclude<
    // ^?
    Parameters<p["on"]>[0],
    | "Contract0:setup"
    | "Contract0:Event0"
    | "Contract1:setup"
    | "Contract1:Event1"
  >;

  assertType<never>("" as name);
});

test("PonderApp event name", () => {
  type p = PonderApp<
    // ^?
    {
      networks: any;
      contracts: { Contract: { network: any; abi: [Event0] } };
    },
    any
  >;

  type name = Extract<
    // ^?
    Parameters<Parameters<p["on"]>[1]>[0],
    { event: unknown }
  >["event"]["name"];

  assertType<name>("" as "Event0");
});

test("PonderApp event args", () => {
  type p = PonderApp<
    // ^?
    {
      networks: any;
      contracts: { Contract: { network: any; abi: [Event0] } };
    },
    any
  >;

  type args = Extract<
    // ^?
    Parameters<Parameters<p["on"]>[1]>[0],
    { event: unknown }
  >["event"]["args"];

  assertType<args>({} as unknown as { arg: Hex; arg1: Hex });
});

test("PonderApp event args with unnamed param", () => {
  type p = PonderApp<
    // ^?
    {
      networks: any;
      contracts: { Contract: { network: any; abi: [Event1Overloaded] } };
    },
    any
  >;

  type args = Extract<
    // ^?
    Parameters<Parameters<p["on"]>[1]>[0],
    { event: unknown }
  >["event"]["args"];

  assertType<args>({} as unknown as [Hex]);
});

test("PonderApp event name filtering", () => {
  type p = PonderApp<
    // ^?
    {
      networks: any;
      contracts: {
        Contract: {
          network: any;
          abi: [Event0, Event1];
          filter: { event: ["Event0"] };
        };
      };
    },
    any
  >;

  type name = Extract<
    // ^?
    Parameters<Parameters<p["on"]>[1]>[0],
    { event: unknown }
  >["event"]["name"];

  assertType<name>("" as "Event0");
});

test("PonderApp context.network", () => {
  type p = PonderApp<
    // ^?
    {
      networks: {
        mainnet: { chainId: 1; transport: any };
        optimism: { chainId: 10; transport: any };
      };
      contracts: {
        Contract: {
          network: { mainnet: {}; optimism: {} };
          abi: [Event0];
        };
      };
    },
    any
  >;

  type network =
    // ^?
    Parameters<Parameters<p["on"]>[1]>[0]["context"]["network"];

  assertType<network>(
    {} as { name: "mainnet"; chainId: 1 } | { name: "optimism"; chainId: 10 },
  );
});

test("PonderApp context.client", () => {
  type p = PonderApp<
    // ^?
    {
      networks: {
        mainnet: { chainId: 1; transport: any };
        optimism: { chainId: 10; transport: any };
      };
      contracts: {
        Contract: {
          network: { mainnet: {}; optimism: {} };
          abi: [Event0];
        };
      };
    },
    any
  >;

  type client =
    // ^?
    Parameters<Parameters<p["on"]>[1]>[0]["context"]["client"];

  assertType<client>({} as Omit<ReadOnlyClient, "extend">);
});

test("PonderApp context.contracts", () => {
  type p = PonderApp<
    // ^?
    {
      networks: {
        mainnet: { chainId: 1; transport: any };
        optimism: { chainId: 10; transport: any };
      };
      contracts: {
        Contract: {
          network: { mainnet: { address: "0x1" }; optimism: {} };
          abi: [Event0];
          address: "0x2";
          startBlock: 1;
          endBlock: 2;
        };
      };
    },
    any
  >;

  type contracts =
    // ^?
    Parameters<Parameters<p["on"]>[1]>[0]["context"]["contracts"];

  assertType<contracts>(
    {} as {
      Contract: {
        abi: [Event0];
        address: "0x1" | "0x2";
        startBlock: 1;
        endBlock: 2;
      };
    },
  );
});
