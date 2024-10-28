import { onchainTable } from "../../../drizzle/index.js";

export const account = onchainTable("account", (p) => ({
  address: p.hex().primaryKey(),
  balance: p.bigint().notNull(),
}));
