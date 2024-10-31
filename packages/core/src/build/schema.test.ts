import { onchainSchema, onchainTable } from "@/index.js";
import { sql } from "drizzle-orm";
import { check, pgSequence, pgView, primaryKey } from "drizzle-orm/pg-core";
import { expect, test } from "vitest";
import { buildSchema } from "./schema.js";

const instanceId = "1234";

test("success", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  buildSchema({ schema, instanceId });
});

test("serial", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.serial().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  buildSchema({ schema, instanceId });
});

test("primary key", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().primaryKey(),
    })),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("composite primary key", () => {
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

test("view", () => {
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

test("sequences", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
    seq: pgSequence("seq"),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("schema", () => {
  const schema = {
    ponder: onchainSchema("ponder"),
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("generated", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.serial().primaryKey(),
      balance: p.bigint().notNull().generatedAlwaysAs(10n),
    })),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("foreign key", () => {
  // @ts-ignore
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.serial().primaryKey(),
      balance: p
        .bigint()
        .notNull()
        .references(() => schema.account.address),
    })),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("unique", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.serial().primaryKey(),
      balance: p.bigint().notNull().unique(),
    })),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("check", () => {
  const schema = {
    account: onchainTable(
      "account",
      (p) => ({
        address: p.serial().primaryKey(),
        balance: p.bigint().notNull(),
      }),
      () => ({
        check: check("test", sql``),
      }),
    ),
  };

  expect(() => buildSchema({ schema, instanceId })).toThrowError();
});

test("enum", () => {
  const p = onchainSchema("p");
  const mood = p.enum("mood", ["good", "bad"]);
  const schema = {
    p,
    mood,
    account: p.table("account", (p) => ({
      address: p.serial().primaryKey(),
      m: mood().notNull(),
    })),
  };

  buildSchema({ schema, instanceId });
});
