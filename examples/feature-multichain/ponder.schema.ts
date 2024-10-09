import { onchainTable } from "@ponder/core";

export const account = onchainTable("account", (t) => ({
  address: t.evmHex().primaryKey(),
  balance: t.evmBigint().notNull(),
}));
