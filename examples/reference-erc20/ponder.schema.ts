import { ponderBigint, ponderHex } from "@ponder/core";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
} from "drizzle-orm/pg-core";

export const account = pgTable("account", {
  address: ponderHex("address").notNull().primaryKey(),
  balance: ponderBigint("balance").notNull(),
  isOwner: boolean("is_owner").notNull(),
});

export const allowance = pgTable(
  "allowance",
  {
    owner: ponderHex("owner").notNull(),
    spender: ponderHex("spender").notNull(),
    amount: ponderBigint("amount").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.owner, table.spender] }),
  }),
);

export const transferEvent = pgTable(
  "transfer_event",
  {
    id: serial("id").primaryKey(),
    amount: ponderBigint("amount").notNull(),
    timestamp: integer("timestamp").notNull(),
    from: ponderHex("from").notNull(),
    to: ponderHex("to").notNull(),
  },
  (table) => ({
    fromIdx: index("from_index").on(table.from),
  }),
);

export const approvalEvent = pgTable("approval_event", {
  id: serial("id").primaryKey(),
  amount: ponderBigint("amount").notNull(),
  timestamp: integer("timestamp").notNull(),
  owner: ponderHex("from").notNull(),
  spender: ponderHex("to").notNull(),
});
