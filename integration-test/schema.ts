import { pgSchema, pgTable, primaryKey } from "drizzle-orm/pg-core";

export const metadata = pgTable("metadata", (t) => ({
  id: t.uuid().primaryKey(),
  seed: t.text().notNull(),
  app: t.text().notNull(),
  commit: t.text().notNull(),
  branch: t.text().notNull(),
  version: t.text().notNull(),
  time: t.timestamp().notNull(),
  ci: t.boolean().notNull(),
  success: t.boolean().notNull(),
}));

export const rpcCache = pgSchema("rpc_cache");

export const blocks = rpcCache.table(
  "eth_getBlock",
  (t) => ({
    chainId: t.bigint({ mode: "number" }).notNull(),
    number: t.bigint({ mode: "number" }).notNull(),
    hash: t.text().notNull(),
    body: t.jsonb().notNull(),
  }),
  (table) => [primaryKey({ columns: [table.chainId, table.number] })],
);

export const transactionReceipts = rpcCache.table(
  "eth_getTransactionReceipt",
  (t) => ({
    chainId: t.bigint({ mode: "number" }).notNull(),
    transactionHash: t.text().notNull(),
    body: t.jsonb().notNull(),
  }),
  (table) => [primaryKey({ columns: [table.chainId, table.transactionHash] })],
);

export const blockReceipts = rpcCache.table(
  "eth_getBlockReceipts",
  (t) => ({
    chainId: t.bigint({ mode: "number" }).notNull(),
    blockHash: t.text().notNull(),
    body: t.jsonb().notNull(),
  }),
  (table) => [primaryKey({ columns: [table.chainId, table.blockHash] })],
);

export const traces = rpcCache.table(
  "debug_traceBlock",
  (t) => ({
    chainId: t.bigint({ mode: "number" }).notNull(),
    number: t.bigint({ mode: "number" }).notNull(),
    body: t.jsonb().notNull(),
  }),
  (table) => [primaryKey({ columns: [table.chainId, table.number] })],
);

export const logs = rpcCache.table(
  "eth_getLogs",
  (t) => ({
    chainId: t.bigint({ mode: "number" }).notNull(),
    blockNumber: t.bigint({ mode: "number" }).notNull(),
    body: t.jsonb().notNull(),
  }),
  (table) => [primaryKey({ columns: [table.chainId, table.blockNumber] })],
);
