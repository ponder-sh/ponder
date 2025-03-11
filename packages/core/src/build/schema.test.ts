import { onchainEnum, onchainTable } from "@/index.js";
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

test("buildSchema() success", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  buildSchema({ schema });
});

test("buildSchema() error with multiple primary key", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().primaryKey(),
    })),
  };

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildSchema() error with no primary key", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex(),
      balance: p.bigint(),
    })),
  };

  expect(() => buildSchema({ schema })).toThrowError();
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

  buildSchema({ schema });
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

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildScheama() error with sequences", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
    seq: pgSequence("seq"),
  };

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildScheama() error with generated", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().notNull().generatedAlwaysAs(10n),
    })),
  };

  expect(() => buildSchema({ schema })).toThrowError();
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

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildScheama() error with serial", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: serial().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildScheama() success with default", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().default(10n),
    })),
  };

  buildSchema({ schema });
});

test("buildScheama() error with default sql", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().default(sql`10`),
    })),
  };

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildScheama() error with $defaultFn sql", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().$defaultFn(() => sql`10`),
    })),
  };

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildScheama() error with $onUpdateFn sql", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().$onUpdateFn(() => sql`10`),
    })),
  };

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildScheama() error with foreign key", () => {
  // @ts-ignore
  const ref = () => schema.account.address;
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().notNull().references(ref),
    })),
  } as any;

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildScheama() error with unique", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().notNull().unique(),
    })),
  };

  expect(() => buildSchema({ schema })).toThrowError();
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

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildScheama() success with enum", () => {
  const mood = onchainEnum("mood", ["good", "bad"]);
  const schema = {
    mood,
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      m: mood().notNull(),
    })),
  };

  buildSchema({ schema });
});
