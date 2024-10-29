import { onchainTable } from "@ponder/core";

export const depositEvent = onchainTable("deposit_event", (p) => ({
  id: p.serial().primaryKey(),
  timestamp: p.integer().notNull(),
  amount: p.bigint().notNull(),
  account: p.hex().notNull(),
}));
