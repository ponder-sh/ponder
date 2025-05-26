import { onchainTable } from "ponder";

export const state = onchainTable("state", (p) => ({
  chainId: p.integer().primaryKey(),
  blockNumber: p.bigint().notNull(),
  blockHash: p.hex().notNull(),
  logIndex: p.integer().notNull(),
  transactionHash: p.hex().notNull(),
  transactionIndex: p.integer().notNull(),
}));
