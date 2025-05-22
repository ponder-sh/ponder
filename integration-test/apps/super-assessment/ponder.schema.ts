import { onchainTable, primaryKey } from "ponder";

export const table = onchainTable(
  "events",
  (t) => ({
    chainId: t.int8({ mode: "number" }).notNull(),
    name: t.text().notNull(),
    id: t.varchar({ length: 75 }).notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.name, table.id] }),
  }),
);
