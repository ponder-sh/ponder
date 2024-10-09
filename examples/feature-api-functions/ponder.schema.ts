import {
  index,
  offchainSchema,
  onchainTable,
  primaryKey,
} from "@ponder/core/db";

export const account = onchainTable("account", (t) => ({
  address: t.evmHex().primaryKey(),
  balance: t.evmBigint().notNull(),
  isOwner: t.boolean().notNull(),
}));

export const allowance = onchainTable(
  "allowance",
  (t) => ({
    owner: t.evmHex(),
    spender: t.evmHex(),
    amount: t.evmBigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.owner, table.spender] }),
  }),
);

export const transferEvent = onchainTable(
  "transfer_event",
  (t) => ({
    id: t.serial().primaryKey(),
    amount: t.evmBigint().notNull(),
    timestamp: t.integer().notNull(),
    from: t.evmHex().notNull(),
    to: t.evmHex().notNull(),
  }),
  (table) => ({
    fromIdx: index("from_index").on(table.from),
  }),
);

export const approvalEvent = onchainTable("approval_event", (t) => ({
  id: t.serial().primaryKey(),
  amount: t.evmBigint().notNull(),
  timestamp: t.integer().notNull(),
  owner: t.evmHex().notNull(),
  spender: t.evmHex().notNull(),
}));

export const schema = offchainSchema("offchain");

export const metadata = schema.table("metadata", (t) => ({
  id: t.serial().primaryKey(),
  account: t.evmHex().notNull(),
}));
