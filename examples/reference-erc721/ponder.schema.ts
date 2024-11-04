import { onchainTable } from "@ponder/core";

export const account = onchainTable("account", (p) => ({
  address: p.hex().primaryKey(),
}));

export const token = onchainTable("token", (p) => ({
  id: p.bigint().primaryKey(),
  owner: p.hex().notNull(),
}));

export const transferEvent = onchainTable("transfer_event", (p) => ({
  id: p.text().primaryKey(),
  timestamp: p.integer().notNull(),
  from: p.hex().notNull(),
  to: p.hex().notNull(),
  token: p.bigint().notNull(),
}));
