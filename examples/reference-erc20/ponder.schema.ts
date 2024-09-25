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
    owner: ponderHex("owner"),
    spender: ponderHex("spender"),
    amount: ponderBigint("amount"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.owner, table.spender] }),
  }),
);

export const transferEvent = pgTable(
  "transfer_event",
  {
    id: serial("id").primaryKey(),
    amount: ponderBigint("amount"),
    timestamp: integer("timestamp"),
    from: ponderHex("from"),
    to: ponderHex("to"),
  },
  (table) => ({
    fromIdx: index("from_index").on(table.from),
  }),
);

export const approvalEvent = pgTable("approval_event", {
  id: serial("id").primaryKey(),
  amount: ponderBigint("amount"),
  timestamp: integer("timestamp"),
  owner: ponderHex("from"),
  spender: ponderHex("to"),
});
