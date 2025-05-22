import { onchainTable, primaryKey } from "ponder";

export const state = onchainTable("state", (t) => ({
  chainId: t.int8({ mode: "number" }).primaryKey(),
  serial: t.integer().notNull(),
}));

export const table = onchainTable(
  "event",
  (t) => ({
    chainId: t.int8({ mode: "number" }).notNull(),
    id: t.text().notNull(),
    name: t.text().notNull(),
    serial: t.integer().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.serial] }),
  }),
);
