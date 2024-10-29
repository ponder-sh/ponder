import { onchainTable } from "@ponder/core";

export const multicall = onchainTable("multicall", (p) => ({
  from: p.hex().primaryKey(),
  gasUsed: p.bigint().notNull(),
  bytes: p.integer().notNull(),
  successfulCalls: p.integer().notNull(),
  failedCalls: p.integer().notNull(),
}));
