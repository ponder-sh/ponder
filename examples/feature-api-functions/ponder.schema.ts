import { index, onchainTable, primaryKey } from "ponder";

export const account = onchainTable("account", (p) => ({
  address: p.hex().primaryKey(),
  balance: p.bigint().notNull(),
  isOwner: p.boolean().notNull(),
}));

export const allowance = onchainTable(
  "allowance",
  (p) => ({
    owner: p.hex(),
    spender: p.hex(),
    amount: p.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.owner, table.spender] }),
  }),
);

export const transferEvent = onchainTable(
  "transfer_event",
  (p) => ({
    id: p.text().primaryKey(),
    amount: p.bigint().notNull(),
    timestamp: p.integer().notNull(),
    from: p.hex().notNull(),
    to: p.hex().notNull(),
  }),
  (table) => ({
    fromIdx: index("from_index").on(table.from),
  }),
);

export const approvalEvent = onchainTable("approval_event", (p) => ({
  id: p.text().primaryKey(),
  amount: p.bigint().notNull(),
  timestamp: p.integer().notNull(),
  owner: p.hex().notNull(),
  spender: p.hex().notNull(),
}));
