import {
  boolean,
  evmBigint,
  evmHex,
  index,
  integer,
  onchainTable,
  primaryKey,
  serial,
} from "@ponder/core/db";

export const account = onchainTable("account", {
  address: evmHex("address").primaryKey(),
  balance: evmBigint("balance").notNull(),
  isOwner: boolean("is_owner").notNull(),
});

export const allowance = onchainTable(
  "allowance",
  {
    owner: evmHex("owner"),
    spender: evmHex("spender"),
    amount: evmBigint("amount").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.owner, table.spender] }),
  }),
);

export const transferEvent = onchainTable(
  "transfer_event",
  {
    id: serial("id").primaryKey(),
    amount: evmBigint("amount").notNull(),
    timestamp: integer("timestamp").notNull(),
    from: evmHex("from").notNull(),
    to: evmHex("to").notNull(),
  },
  (table) => ({
    fromIdx: index("from_index").on(table.from),
  }),
);

export const approvalEvent = onchainTable("approval_event", {
  id: serial("id").primaryKey(),
  amount: evmBigint("amount").notNull(),
  timestamp: integer("timestamp").notNull(),
  owner: evmHex("from").notNull(),
  spender: evmHex("to").notNull(),
});
