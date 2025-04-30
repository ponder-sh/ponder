import {
  setupCleanup,
  setupCommon,
  setupDatabase,
  setupPonder,
} from "@/_test/setup.js";
import { getBlocksConfigAndIndexingFunctions } from "@/_test/utils.js";
import { onchainTable } from "@/drizzle/onchain.js";
import type { BlockEvent, LogEvent, TraceEvent } from "@/internal/types.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import type { Column, Table } from "drizzle-orm";
import { zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import { recordProfilePattern } from "./profile.js";

beforeEach(setupCommon);
beforeEach(setupDatabase);
beforeEach(setupCleanup);

test("recordProfilePattern() no pattern", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "block",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
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

test("recordProfilePattern() with undefined log event args", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "log",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: undefined,
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

  expect(pattern).toBeUndefined();
});

test("recordProfilePattern() with undefined trace event args", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "trace",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: undefined,
      result: undefined,
      trace: {} as TraceEvent["event"]["trace"],
      transaction: {} as TraceEvent["event"]["transaction"],
      block: {} as BlockEvent["event"]["block"],
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

test("recordProfilePattern() with array log event args", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "log",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: [],
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

  expect(pattern).toBeUndefined();
});

test("recordProfilePattern() with array trace event args", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "trace",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: [],
      result: [],
      trace: {} as TraceEvent["event"]["trace"],
      transaction: {} as TraceEvent["event"]["transaction"],
      block: {} as BlockEvent["event"]["block"],
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

test("recordProfilePattern() chainId", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "block",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
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
      "address": [
        "chainId",
      ],
    }
  `);
});

test("recordProfilePattern() log args", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "log",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
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
      "address": [
        "args",
        "address",
      ],
    }
  `);
});

test("recordProfilePattern() block", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "block",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
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
      "address": [
        "block",
        "number",
      ],
    }
  `);
});

test("recordProfilePattern() hint", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "block",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
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
      "address": [
        "block",
        "number",
      ],
    }
  `);
});

test("recordProfilePattern() object args", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "log",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
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
