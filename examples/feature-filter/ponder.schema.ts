import { onchainTable } from "@ponder/core";

export const swapEvent = onchainTable("swapEvent", (t) => ({
  id: t.text().primaryKey(),
  recipient: t.hex().notNull(),
  payer: t.hex().notNull(),
}));
