import type { ParseAbiItem } from "abitype";
import { assertType, test } from "vitest";

import type { ReadOnlyClient } from "@/indexing/ponderActions.js";

import type { ExtractContext, PonderApp } from "./ponder.js";

type Event0 = ParseAbiItem<"event Event0(bytes32 indexed arg)">;
type Event1 = ParseAbiItem<"event Event1()">;
type Event1Overloaded = ParseAbiItem<"event Event1(bytes32)">;

test("PonderApp setup", () => {
  type p = PonderApp<
    // ^?
    {
      networks: any;
      contracts: {
        Contract: { network: any; abi: [] };
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

test("ExtractContext", () => {
  type context = ExtractContext<
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

  assertType<context["network"]>(
    {} as { name: "mainnet"; chainId: 1 } | { name: "optimism"; chainId: 10 },
  );
  assertType<context["client"]>({} as Omit<ReadOnlyClient, "extend">);
  assertType<context["contracts"]>(
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
