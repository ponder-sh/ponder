import { onchainTable } from "@ponder/core";

export const file = onchainTable("file", (p) => ({
  name: p.text().primaryKey(),
  size: p.integer().notNull(),
  contents: p.text().notNull(),
  createdAt: p.integer().notNull(),
  type: p.text(),
  encoding: p.text(),
  compression: p.text(),
}));
