import { onchainTable, primaryKey } from "ponder";

export const checkpoints = onchainTable("checkpoints", (t) => ({
  chainId: t.int8({ mode: "number" }).primaryKey(),
  id: t.varchar({ length: 75 }).notNull(),
}));

export const blocks = onchainTable(
  "blocks",
  (t) => ({
    name: t.text().notNull(),
    id: t.varchar({ length: 75 }).notNull(),
    chainId: t.int8({ mode: "number" }).notNull(),
    number: t.int8({ mode: "number" }).notNull(),
    hash: t.text().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.name, table.id] }),
  }),
);

export const transactions = onchainTable(
  "transactions",
  (t) => ({
    name: t.text().notNull(),
    id: t.varchar({ length: 75 }).notNull(),
    chainId: t.int8({ mode: "number" }).notNull(),
    transactionIndex: t.int8({ mode: "number" }).notNull(),
    hash: t.text().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.name, table.id] }),
  }),
);

export const transactionReceipts = onchainTable(
  "transaction_receipts",
  (t) => ({
    name: t.text().notNull(),
    id: t.varchar({ length: 75 }).notNull(),
    chainId: t.int8({ mode: "number" }).notNull(),
    transactionIndex: t.int8({ mode: "number" }).notNull(),
    hash: t.text().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.name, table.id] }),
  }),
);

export const traces = onchainTable(
  "traces",
  (t) => ({
    name: t.text().notNull(),
    id: t.varchar({ length: 75 }).notNull(),
    chainId: t.int8({ mode: "number" }).notNull(),
    traceIndex: t.int8({ mode: "number" }).notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.name, table.id] }),
  }),
);

export const logs = onchainTable(
  "logs",
  (t) => ({
    name: t.text().notNull(),
    id: t.varchar({ length: 75 }).notNull(),
    chainId: t.int8({ mode: "number" }).notNull(),
    logIndex: t.int8({ mode: "number" }).notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.name, table.id] }),
  }),
);
