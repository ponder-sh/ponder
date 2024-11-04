import { onchainTable, primaryKey } from "@ponder/core";

export const account = onchainTable("account", (p) => ({
  address: p.hex().primaryKey(),
}));

export const tokenBalance = onchainTable(
  "token_balance",
  (p) => ({
    tokenId: p.bigint().notNull(),
    owner: p.hex().notNull(),
    balance: p.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.owner, table.tokenId] }),
  }),
);

export const transferEvent = onchainTable("transfer_event", (p) => ({
  id: p.text().primaryKey(),
  timestamp: p.integer().notNull(),
  from: p.hex().notNull(),
  to: p.hex().notNull(),
  token: p.bigint().notNull(),
}));
