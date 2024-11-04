import { onchainTable } from "../../../drizzle/index.js";

export const account = onchainTable("account", (t) => ({
  address: t.hex().primaryKey(),
  balance: t.bigint().notNull(),
}));
