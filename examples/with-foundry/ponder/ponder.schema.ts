import { onchainTable } from "@ponder/core";

export const counter = onchainTable("counter", (p) => ({
  value: p.integer().primaryKey(),
  block: p.integer().notNull(),
}));
