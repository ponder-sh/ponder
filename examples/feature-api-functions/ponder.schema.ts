import {
  boolean,
  evmBigint,
  evmHex,
  index,
  integer,
  offchainSchema,
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
    amount: evmBigint("amount").$type<bigint>(),
    timestamp: integer("timestamp"),
    from: evmHex("from"),
    to: evmHex("to"),
  },
  (table) => ({
    fromIdx: index("from_index").on(table.from),
  }),
);

export const approvalEvent = onchainTable("approval_event", {
  id: serial("id").primaryKey(),
  amount: evmBigint("amount"),
  timestamp: integer("timestamp"),
  owner: evmHex("from"),
  spender: evmHex("to"),
});

export const schema = offchainSchema("offchain");

export const metadata = schema.table("metadata", {
  id: serial("id").primaryKey(),
  account: evmHex("account").notNull(),
});
