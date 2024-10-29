import { onchainTable } from "@ponder/core";

export const swapEvent = onchainTable("swapEvent", (p) => ({
  id: p.serial().primaryKey(),
  recipient: p.hex().notNull(),
  payer: p.hex().notNull(),
}));
