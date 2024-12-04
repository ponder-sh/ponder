import { onchainTable } from "ponder";

export const file = onchainTable("file", (t) => ({
  name: t.text().primaryKey(),
  size: t.integer().notNull(),
  contents: t.text().notNull(),
  createdAt: t.integer().notNull(),
  type: t.text(),
  encoding: t.text(),
  compression: t.text(),
}));
