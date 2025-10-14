import {
  bigint,
  hex,
  onchainEnum,
  onchainTable,
  onchainView,
} from "@/index.js";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgSequence,
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

test("buildSchema() error with sequences", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
    seq: pgSequence("seq"),
  };

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildSchema() error with generated", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().notNull().generatedAlwaysAs(10n),
    })),
  };

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildSchema() error with generated identity", () => {
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

test("buildSchema() error with serial", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: serial().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildSchema() success with default", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().default(10n),
    })),
  };

  buildSchema({ schema });
});

test("buildSchema() error with default sql", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().default(sql`10`),
    })),
  };

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildSchema() error with $defaultFn sql", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().$defaultFn(() => sql`10`),
    })),
  };

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildSchema() error with $onUpdateFn sql", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().$onUpdateFn(() => sql`10`),
    })),
  };

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildSchema() error with foreign key", () => {
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

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildSchema() error with unique", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().notNull().unique(),
    })),
  };

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildSchema() error with check", () => {
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

test("buildSchema() success with enum", () => {
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

test("buildSchema() duplicate table name", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
    })),
    account2: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
    })),
  };

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildSchema() duplicate index name", () => {
  const schema = {
    account: onchainTable(
      "account",
      (p) => ({
        address: p.hex().primaryKey(),
        balance: p.bigint().notNull(),
      }),
      (table) => ({
        balanceIdx: index("balance_idx").on(table.balance),
      }),
    ),
    account2: onchainTable(
      "account2",
      (p) => ({
        address: p.hex().primaryKey(),
        balance: p.bigint().notNull(),
      }),
      (table) => ({
        balanceIdx: index("balance_idx").on(table.balance),
      }),
    ),
  };

  expect(() => buildSchema({ schema })).toThrowError();
});

test("buildSchema view", () => {
  const account = onchainTable(
    "account",
    (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    }),
    (table) => ({
      balanceIdx: index("balance_idx").on(table.balance),
    }),
  );
  const schema = {
    account,
    accountView: onchainView("account_view").as((qb) =>
      qb.select().from(account),
    ),
  };

  buildSchema({ schema });
});

test("buildSchema view raw sql", () => {
  const account = onchainTable(
    "account",
    (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    }),
    (table) => ({
      balanceIdx: index("balance_idx").on(table.balance),
    }),
  );
  const schema = {
    account,
    accountView: onchainView("account_view", {
      address: hex().primaryKey(),
      balance: bigint().notNull(),
    }).as(sql`SELECT * FROM account`),
  };

  buildSchema({ schema });
});
