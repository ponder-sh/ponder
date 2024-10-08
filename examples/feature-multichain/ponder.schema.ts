import { evmBigint, evmHex, onchainTable } from "@ponder/core/db";

export const account = onchainTable("account", {
  address: evmHex("address").primaryKey(),
  balance: evmBigint("balance").notNull(),
});
