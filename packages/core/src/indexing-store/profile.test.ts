import { onchainTable } from "@/drizzle/onchain.js";
import type { BlockEvent, LogEvent } from "@/internal/types.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import type { Column, Table } from "drizzle-orm";
import { zeroAddress } from "viem";
import { expect, test } from "vitest";
import { recordProfilePattern } from "./profile.js";

test("recordProfilePattern() no pattern", () => {
  const event = {
    type: "block",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      block: {} as BlockEvent["event"]["block"],
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

test("recordProfilePattern() chainId", () => {
  const event = {
    type: "block",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      block: {} as BlockEvent["event"]["block"],
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
      "address": "chainId",
    }
  `);
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
      block: {} as BlockEvent["event"]["block"],
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
      "address": "args.address",
    }
  `);
});

test("recordProfilePattern() block", () => {
  const event = {
    type: "block",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      block: { number: 3n } as BlockEvent["event"]["block"],
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
      "address": "block.number",
    }
  `);
});

test("recordProfilePattern() hint", () => {
  const event = {
    type: "block",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      block: { number: 3n } as BlockEvent["event"]["block"],
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
        "address": "block.number",
      }
    `);
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
      block: {} as BlockEvent["event"]["block"],
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
