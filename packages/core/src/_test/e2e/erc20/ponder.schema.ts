import { onchainTable } from "../../../drizzle/onchain.js";

export const account = onchainTable("account", (t) => ({
  address: t.hex().primaryKey(),
  balance: t.bigint().notNull(),
}));
