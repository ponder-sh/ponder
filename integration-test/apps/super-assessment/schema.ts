import { pgSchema, primaryKey } from "drizzle-orm/pg-core";

export const expected = pgSchema("expected");

export const checkpoints = expected.table("checkpoints", (t) => ({
  chainId: t.bigint({ mode: "number" }).primaryKey(),
  id: t.varchar({ length: 75 }).notNull(),
}));

export const blocks = expected.table(
  "blocks",
  (t) => ({
    name: t.text().notNull(),
    id: t.varchar({ length: 75 }).notNull(),
    chainId: t.bigint({ mode: "number" }).notNull(),
    number: t.bigint({ mode: "number" }).notNull(),
    hash: t.text().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.name, table.id] }),
  }),
);

export const transactions = expected.table(
  "transactions",
  (t) => ({
    name: t.text().notNull(),
    id: t.varchar({ length: 75 }).notNull(),
    chainId: t.bigint({ mode: "number" }).notNull(),
    transactionIndex: t.bigint({ mode: "number" }).notNull(),
    hash: t.text().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.name, table.id] }),
  }),
);

export const transactionReceipts = expected.table(
  "transaction_receipts",
  (t) => ({
    name: t.text().notNull(),
    id: t.varchar({ length: 75 }).notNull(),
    chainId: t.bigint({ mode: "number" }).notNull(),
    transactionIndex: t.bigint({ mode: "number" }).notNull(),
    hash: t.text().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.name, table.id] }),
  }),
);

export const traces = expected.table(
  "traces",
  (t) => ({
    name: t.text().notNull(),
    id: t.varchar({ length: 75 }).notNull(),
    chainId: t.bigint({ mode: "number" }).notNull(),
    traceIndex: t.bigint({ mode: "number" }).notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.name, table.id] }),
  }),
);

export const logs = expected.table(
  "logs",
  (t) => ({
    name: t.text().notNull(),
    id: t.varchar({ length: 75 }).notNull(),
    chainId: t.bigint({ mode: "number" }).notNull(),
    logIndex: t.bigint({ mode: "number" }).notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.name, table.id] }),
  }),
);
