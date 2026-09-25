import { onchainTable } from "ponder";

export const usdcTransfer = onchainTable("usdc_transfer", (t) => ({
  id: t.text().primaryKey(),
  from: t.hex().notNull(),
  to: t.hex().notNull(),
  amount: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}));

export const minterTransaction = onchainTable("minter_transaction", (t) => ({
  id: t.text().primaryKey(),
  to: t.hex(),
  value: t.bigint().notNull(),
  data: t.hex().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}));
