import { onchainTable } from "@ponder/core";

export const counter = onchainTable("counter", (t) => ({
  value: t.integer().primaryKey(),
  block: t.integer().notNull(),
}));
