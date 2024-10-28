import { onchainTable } from "@ponder/core";

export const account = onchainTable("account", (t) => ({
  address: t.hex().primaryKey(),
  balance: t.bigint().notNull(),
}));
