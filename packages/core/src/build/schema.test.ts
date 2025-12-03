import {
  bigint,
  hex,
  onchainEnum,
  onchainTable,
  onchainView,
} from "@/index.js";
import { count, sql, sum } from "drizzle-orm";
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

  buildSchema({ schema, preBuild: { ordering: "multichain" } });
});

test("buildSchema() error with multiple primary key", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().primaryKey(),
    })),
  };

  expect(() =>
    buildSchema({ schema, preBuild: { ordering: "multichain" } }),
  ).toThrowError();
});

test("buildSchema() error with no primary key", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex(),
      balance: p.bigint(),
    })),
  };

  expect(() =>
    buildSchema({ schema, preBuild: { ordering: "multichain" } }),
  ).toThrowError();
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

  buildSchema({ schema, preBuild: { ordering: "multichain" } });
});

test("buildSchema() error with sequences", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
    seq: pgSequence("seq"),
  };

  expect(() =>
    buildSchema({ schema, preBuild: { ordering: "multichain" } }),
  ).toThrowError();
});

test("buildSchema() error with generated", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().notNull().generatedAlwaysAs(10n),
    })),
  };

  expect(() =>
    buildSchema({ schema, preBuild: { ordering: "multichain" } }),
  ).toThrowError();
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

  expect(() =>
    buildSchema({ schema, preBuild: { ordering: "multichain" } }),
  ).toThrowError();
});

test("buildSchema() error with serial", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: serial().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  expect(() =>
    buildSchema({ schema, preBuild: { ordering: "multichain" } }),
  ).toThrowError();
});

test("buildSchema() success with default", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().default(10n),
    })),
  };

  buildSchema({ schema, preBuild: { ordering: "multichain" } });
});

test("buildSchema() error with default sql", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().default(sql`10`),
    })),
  };

  expect(() =>
    buildSchema({ schema, preBuild: { ordering: "multichain" } }),
  ).toThrowError();
});

test("buildSchema() error with $defaultFn sql", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().$defaultFn(() => sql`10`),
    })),
  };

  expect(() =>
    buildSchema({ schema, preBuild: { ordering: "multichain" } }),
  ).toThrowError();
});

test("buildSchema() error with $onUpdateFn sql", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().$onUpdateFn(() => sql`10`),
    })),
  };

  expect(() =>
    buildSchema({ schema, preBuild: { ordering: "multichain" } }),
  ).toThrowError();
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

  expect(() =>
    buildSchema({ schema, preBuild: { ordering: "multichain" } }),
  ).toThrowError();
});

test("buildSchema() error with unique", () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.integer().primaryKey(),
      balance: p.bigint().notNull().unique(),
    })),
  };

  expect(() =>
    buildSchema({ schema, preBuild: { ordering: "multichain" } }),
  ).toThrowError();
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

  expect(() =>
    buildSchema({ schema, preBuild: { ordering: "multichain" } }),
  ).toThrowError();
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

  buildSchema({ schema, preBuild: { ordering: "multichain" } });
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

  expect(() =>
    buildSchema({ schema, preBuild: { ordering: "multichain" } }),
  ).toThrowError();
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

  expect(() =>
    buildSchema({ schema, preBuild: { ordering: "multichain" } }),
  ).toThrowError();
});

test("buildSchema exp", () => {
  const schema1 = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  expect(() =>
    buildSchema({
      schema: schema1,
      preBuild: { ordering: "experimental_isolated" },
    }),
  ).toThrowError();

  const schema2 = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      chainId: p.integer().notNull(),
      balance: p.bigint().notNull(),
    })),
  };

  expect(() =>
    buildSchema({
      schema: schema2,
      preBuild: { ordering: "experimental_isolated" },
    }),
  ).toThrowError();

  const schema3 = {
    account: onchainTable(
      "account",
      (p) => ({
        address: p.hex().notNull(),
        chainId: p.integer().notNull(),
        balance: p.bigint().notNull(),
      }),
      (table) => ({
        pk: primaryKey({ columns: [table.address, table.chainId] }),
      }),
    ),
  };

  buildSchema({
    schema: schema3,
    preBuild: { ordering: "experimental_isolated" },
  });
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

  buildSchema({ schema, preBuild: { ordering: "multichain" } });
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

  buildSchema({ schema, preBuild: { ordering: "multichain" } });
});

test("buildSchema view with aggregate functions", () => {
  const trade = onchainTable("trade", (p) => ({
    id: p.text().primaryKey(),
    marketAddress: p.hex().notNull(),
    cost: p.bigint().notNull(),
  }));

  const schema = {
    trade,
    tradeVolume: onchainView("trade_volume").as((qb) =>
      qb
        .select({
          marketAddress: trade.marketAddress,
          volume: sum(trade.cost).as("volume"),
          count: count().as("count"),
        })
        .from(trade)
        .groupBy(trade.marketAddress),
    ),
  };

  buildSchema({ schema, preBuild: { ordering: "multichain" } });
});

test("buildSchema view with sql template and alias", () => {
  const transfer = onchainTable("transfer", (p) => ({
    id: p.text().primaryKey(),
    timestamp: p.bigint().notNull(),
    amount: p.bigint().notNull(),
  }));

  const schema = {
    transfer,
    hourlyBucket: onchainView("hourly_bucket").as((qb) =>
      qb
        .select({
          hour: sql`FLOOR(${transfer.timestamp} / 3600) * 3600`.as("hour"),
          totalVolume: sum(transfer.amount).as("total_volume"),
          transferCount: count().as("transfer_count"),
        })
        .from(transfer)
        .groupBy(sql`FLOOR(${transfer.timestamp} / 3600)`),
    ),
  };

  buildSchema({ schema, preBuild: { ordering: "multichain" } });
});

test("buildSchema view with mixed PgColumn and SQL.Aliased fields", () => {
  const account = onchainTable("account", (p) => ({
    id: p.text().primaryKey(),
    owner: p.hex().notNull(),
    balance: p.bigint().notNull(),
  }));

  const schema = {
    account,
    accountSummary: onchainView("account_summary").as((qb) =>
      qb
        .select({
          owner: account.owner,
          totalBalance: sum(account.balance).as("total_balance"),
          accountCount: count().as("account_count"),
        })
        .from(account)
        .groupBy(account.owner),
    ),
  };

  buildSchema({ schema, preBuild: { ordering: "multichain" } });
});
