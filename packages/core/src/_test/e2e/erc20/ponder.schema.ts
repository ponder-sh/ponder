import { onchainTable } from "../../../drizzle/drizzle.js";

export const account = onchainTable("account", (p) => ({
  address: p.evmHex().primaryKey(),
  balance: p.evmBigint().notNull(),
}));
