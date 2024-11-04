import { onchainTable, primaryKey } from "@ponder/core";

export const account = onchainTable("account", (p) => ({
  address: p.hex().primaryKey(),
  balance: p.bigint().notNull(),
}));

export const allowance = onchainTable(
  "allowance",
  (t) => ({
    owner: t.hex(),
    spender: t.hex(),
    amount: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.owner, table.spender] }),
  }),
);

export const transferEvent = onchainTable("transfer_event", (t) => ({
  id: t.text().primaryKey(),
  amount: t.bigint().notNull(),
  timestamp: t.integer().notNull(),
  from: t.hex().notNull(),
  to: t.hex().notNull(),
}));

export const approvalEvent = onchainTable("approval_event", (t) => ({
  id: t.text().primaryKey(),
  amount: t.bigint().notNull(),
  timestamp: t.integer().notNull(),
  owner: t.hex().notNull(),
  spender: t.hex().notNull(),
}));

export const depositEvent = onchainTable("deposit_event", (t) => ({
  id: t.text().primaryKey(),
  sender: t.hex().notNull(),
  receiver: t.hex().notNull(),
  assets: t.bigint().notNull(),
  shares: t.bigint().notNull(),
}));

export const withdrawalEvent = onchainTable("withdrawal_event", (t) => ({
  id: t.text().primaryKey(),
  sender: t.hex().notNull(),
  receiver: t.hex().notNull(),
  owner: t.hex().notNull(),
  assets: t.bigint().notNull(),
  shares: t.bigint().notNull(),
}));
