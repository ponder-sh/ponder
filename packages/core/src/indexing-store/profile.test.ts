import { onchainTable } from "@/drizzle/onchain.js";
import type { BlockEvent, LogEvent, TraceEvent } from "@/internal/types.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import type { Column, Table } from "drizzle-orm";
import { zeroAddress } from "viem";
import { expect, test } from "vitest";
import { recordProfilePattern, recoverProfilePattern } from "./profile.js";

test("recordProfilePattern() no pattern", () => {
  const event = {
    type: "block",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      block: { timestamp: 1n } as BlockEvent["event"]["block"],
    },
  } satisfies BlockEvent;

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const primaryKeyCache = new Map<Table, [string, Column][]>();

  primaryKeyCache.set(schema.account, [["address", schema.account.address]]);

  const pattern = recordProfilePattern(
    event,
    schema.account,
    { address: zeroAddress },
    [],
    primaryKeyCache,
  );

  expect(pattern).toBeUndefined();
});

test("recordProfilePattern() with undefined log event args", () => {
  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: undefined,
      log: {} as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { timestamp: 1n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const primaryKeyCache = new Map<Table, [string, Column][]>();

  primaryKeyCache.set(schema.account, [["address", schema.account.address]]);

  const pattern = recordProfilePattern(
    event,
    schema.account,
    { address: zeroAddress },
    [],
    primaryKeyCache,
  );

  expect(pattern).toBeUndefined();
});

test("recordProfilePattern() with undefined trace event args", () => {
  const event = {
    type: "trace",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: undefined,
      result: undefined,
      trace: {} as TraceEvent["event"]["trace"],
      transaction: {} as TraceEvent["event"]["transaction"],
      block: { timestamp: 1n } as BlockEvent["event"]["block"],
    },
  } satisfies TraceEvent;

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const primaryKeyCache = new Map<Table, [string, Column][]>();

  primaryKeyCache.set(schema.account, [["address", schema.account.address]]);

  const pattern = recordProfilePattern(
    event,
    schema.account,
    { address: zeroAddress },
    [],
    primaryKeyCache,
  );

  expect(pattern).toBeUndefined();
});

test("recordProfilePattern() with array log event args", () => {
  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: [],
      log: {} as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { timestamp: 1n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const primaryKeyCache = new Map<Table, [string, Column][]>();

  primaryKeyCache.set(schema.account, [["address", schema.account.address]]);

  const pattern = recordProfilePattern(
    event,
    schema.account,
    { address: zeroAddress },
    [],
    primaryKeyCache,
  );

  expect(pattern).toBeUndefined();
});

test("recordProfilePattern() with array trace event args", () => {
  const event = {
    type: "trace",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: [],
      result: [],
      trace: {} as TraceEvent["event"]["trace"],
      transaction: {} as TraceEvent["event"]["transaction"],
      block: { timestamp: 1n } as BlockEvent["event"]["block"],
    },
  } satisfies TraceEvent;

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const primaryKeyCache = new Map<Table, [string, Column][]>();

  primaryKeyCache.set(schema.account, [["address", schema.account.address]]);

  const pattern = recordProfilePattern(
    event,
    schema.account,
    { address: zeroAddress },
    [],
    primaryKeyCache,
  );

  expect(pattern).toBeUndefined();
});

test("recordProfilePattern() chainId", () => {
  const event = {
    type: "block",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      block: { timestamp: 1n } as BlockEvent["event"]["block"],
    },
  } satisfies BlockEvent;

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const primaryKeyCache = new Map<Table, [string, Column][]>();

  primaryKeyCache.set(schema.account, [["address", schema.account.address]]);

  const pattern = recordProfilePattern(
    event,
    schema.account,
    { address: 1 },
    [],
    primaryKeyCache,
  );

  expect(pattern).toMatchInlineSnapshot(`
    {
      "address": {
        "value": [
          "chainId",
        ],
      },
    }
  `);

  expect(recoverProfilePattern(pattern!, event)).toMatchInlineSnapshot();
});

test("recordProfilePattern() log args", () => {
  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: {
        address: zeroAddress,
      },
      log: {} as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { timestamp: 1n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const primaryKeyCache = new Map<Table, [string, Column][]>();

  primaryKeyCache.set(schema.account, [["address", schema.account.address]]);

  const pattern = recordProfilePattern(
    event,
    schema.account,
    { address: zeroAddress },
    [],
    primaryKeyCache,
  );

  expect(pattern).toMatchInlineSnapshot(`
    {
      "address": {
        "value": [
          "args",
          "address",
        ],
      },
    }
  `);

  expect(recoverProfilePattern(pattern!, event)).toMatchInlineSnapshot();
});

test("recordProfilePattern() block", () => {
  const event = {
    type: "block",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      block: { number: 3n, timestamp: 1n } as BlockEvent["event"]["block"],
    },
  } satisfies BlockEvent;

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.bigint().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const primaryKeyCache = new Map<Table, [string, Column][]>();

  primaryKeyCache.set(schema.account, [["address", schema.account.address]]);

  const pattern = recordProfilePattern(
    event,
    schema.account,
    { address: 3n },
    [],
    primaryKeyCache,
  );

  expect(pattern).toMatchInlineSnapshot(`
    {
      "address": {
        "value": [
          "block",
          "number",
        ],
      },
    }
  `);

  expect(recoverProfilePattern(pattern!, event)).toMatchInlineSnapshot();
});

test("recordProfilePattern() hint", () => {
  const event = {
    type: "block",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      block: { number: 3n, timestamp: 1n } as BlockEvent["event"]["block"],
    },
  } satisfies BlockEvent;

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.bigint().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const primaryKeyCache = new Map<Table, [string, Column][]>();

  primaryKeyCache.set(schema.account, [["address", schema.account.address]]);

  let pattern = recordProfilePattern(
    event,
    schema.account,
    { address: 3n },
    [],
    primaryKeyCache,
  );

  pattern = recordProfilePattern(
    event,
    schema.account,
    { address: 3n },
    [pattern!],
    primaryKeyCache,
  );

  expect(pattern).toMatchInlineSnapshot(`
    {
      "address": {
        "value": [
          "block",
          "number",
        ],
      },
    }
  `);

  expect(recoverProfilePattern(pattern!, event)).toMatchInlineSnapshot();
});

test("recordProfilePattern() object args", () => {
  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: {
        address: [zeroAddress],
      },
      log: {} as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { timestamp: 1n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const primaryKeyCache = new Map<Table, [string, Column][]>();

  primaryKeyCache.set(schema.account, [["address", schema.account.address]]);

  const pattern = recordProfilePattern(
    event,
    schema.account,
    { address: zeroAddress },
    [],
    primaryKeyCache,
  );

  expect(pattern).toBe(undefined);
});

test("recordProfilePattern() string concat", () => {
  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: {
        address: zeroAddress,
      },
      log: {} as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { timestamp: 26n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const schema = {
    account: onchainTable("account", (p) => ({
      id: p.text().primaryKey(),
      address: p.bigint().notNull(),
      balance: p.bigint().notNull(),
    })),
  };

  const primaryKeyCache = new Map<Table, [string, Column][]>();

  primaryKeyCache.set(schema.account, [["id", schema.account.id]]);

  const pattern = recordProfilePattern(
    event,
    schema.account,
    { id: `${1}-${zeroAddress}` },
    [],
    primaryKeyCache,
  );

  expect(pattern).toMatchInlineSnapshot(`
    {
      "id": {
        "delimiter": "-",
        "values": [
          {
            "value": [
              "chainId",
            ],
          },
          {
            "value": [
              "args",
              "address",
            ],
          },
        ],
      },
    }
  `);

  expect(recoverProfilePattern(pattern!, event)).toMatchInlineSnapshot(`
    {
      "id": "1-0x0000000000000000000000000000000000000000",
    }
  `);
});

test("recordProfilePattern() string concat mixed delimiters", () => {
  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: {
        address: zeroAddress,
      },
      log: {} as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { timestamp: 26n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const schema = {
    account: onchainTable("account", (p) => ({
      id: p.text().primaryKey(),
      address: p.bigint().notNull(),
      balance: p.bigint().notNull(),
    })),
  };

  const primaryKeyCache = new Map<Table, [string, Column][]>();

  primaryKeyCache.set(schema.account, [["id", schema.account.id]]);

  const pattern = recordProfilePattern(
    event,
    schema.account,
    { id: `${1}-${zeroAddress}_${zeroAddress}` },
    [],
    primaryKeyCache,
  );

  expect(pattern).toBe(undefined);
});

test("recordProfilePattern() string concat hint", () => {
  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: {
        address: zeroAddress,
      },
      log: {} as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { timestamp: 26n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const schema = {
    account: onchainTable("account", (p) => ({
      id: p.text().primaryKey(),
      address: p.bigint().notNull(),
      balance: p.bigint().notNull(),
    })),
  };

  const primaryKeyCache = new Map<Table, [string, Column][]>();

  primaryKeyCache.set(schema.account, [["id", schema.account.id]]);

  let pattern = recordProfilePattern(
    event,
    schema.account,
    { id: `${1}-${zeroAddress}` },
    [],
    primaryKeyCache,
  );

  pattern = recordProfilePattern(
    event,
    schema.account,
    { id: `${1}-${zeroAddress}` },
    [pattern!],
    primaryKeyCache,
  );

  expect(pattern).toMatchInlineSnapshot(`
    {
      "id": {
        "delimiter": "-",
        "values": [
          {
            "value": [
              "chainId",
            ],
          },
          {
            "value": [
              "args",
              "address",
            ],
          },
        ],
      },
    }
  `);

  expect(recoverProfilePattern(pattern!, event)).toMatchInlineSnapshot(`
    {
      "id": "1-0x0000000000000000000000000000000000000000",
    }
  `);
});
