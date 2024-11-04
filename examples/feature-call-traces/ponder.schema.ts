import { onchainTable } from "@ponder/core";

export const multicall = onchainTable("multicall", (t) => ({
  from: t.hex().primaryKey(),
  gasUsed: t.bigint().notNull(),
  bytes: t.integer().notNull(),
  successfulCalls: t.integer().notNull(),
  failedCalls: t.integer().notNull(),
}));
