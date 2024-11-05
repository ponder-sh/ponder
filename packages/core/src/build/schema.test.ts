import { onchainSchema, onchainTable } from "@/index.js";
import { sql } from "drizzle-orm";
import {
  check,
  pgSequence,
  pgView,
  primaryKey,
  serial,
} from "drizzle-orm/pg-core";
import { expect, test } from "vitest";
import { buildSchema } from "./schema.js";

const instanceId = "1234";

test("buildSchema() success", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  buildSchema({ schema, instanceId });
});

test("buildSchema() error with schema", () => {
  const schema = {
    ponder: onchainSchema("ponder"),
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("buildSchema() error with multiple primary key", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().primaryKey(),
    })),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("buildSchema() error with no primary key", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex(),
      balance: p.bigint(),
    })),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("buildSchema() success with composite primary key", () => {
  const schema = {
    account: onchainTable(
      "account",
      (p) => ({
        address: p.hex().notNull(),
        balance: p.bigint().notNull(),
      }),
      (table) => ({
        pk: primaryKey({ columns: [table.address, table.balance] }),
      }),
    ),
  };

  buildSchema({ schema, instanceId });
});

test("buildScheama() error with view", () => {
  const account = onchainTable("account", (p) => ({
    address: p.hex().primaryKey(),
    balance: p.bigint().notNull(),
  }));
  const schema = {
    account,
    v: pgView("v").as((qb) => qb.select().from(account)),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("buildScheama() error with sequences", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
    seq: pgSequence("seq"),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("buildScheama() error with generated", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().notNull().generatedAlwaysAs(10n),
    })),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("buildScheama() error with generated identity", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      id: p
        .integer()
        .primaryKey()
        .generatedAlwaysAsIdentity({ startWith: 1000 }),
      balance: p.bigint().notNull(),
    })),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("buildScheama() error with serial", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: serial().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("buildScheama() success with default", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().default(10n),
    })),
  };

  buildSchema({ schema, instanceId });
});

test("buildScheama() error with default sql", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().default(sql`10`),
    })),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("buildScheama() error with $defaultFn sql", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().$defaultFn(() => sql`10`),
    })),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("buildScheama() error with $onUpdateFn sql", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().$onUpdateFn(() => sql`10`),
    })),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("buildScheama() error with foreign key", () => {
  // @ts-ignore
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p
        .bigint()
        .notNull()
        .references(() => schema.account.address),
    })),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("buildScheama() error with unique", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().notNull().unique(),
    })),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("buildScheama() error with check", () => {
  const schema = {
    account: onchainTable(
      "account",
      (p) => ({
        address: p.hex().primaryKey(),
        balance: p.bigint().notNull(),
      }),
      () => ({
        check: check("test", sql``),
      }),
    ),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("buildScheama() success with enum", () => {
  const p = onchainSchema("p");
  const mood = p.enum("mood", ["good", "bad"]);
  const schema = {
    p,
    mood,
    account: p.table("account", (p) => ({
      address: p.hex().primaryKey(),
      m: mood().notNull(),
    })),
  };

  buildSchema({ schema, instanceId });
});
