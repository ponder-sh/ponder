import { onchainTable } from "../../../drizzle/drizzle.js";

export const swapEvent = onchainTable("swap_event", (p) => ({
  id: p.serial().primaryKey(),
  pair: p.evmHex().notNull(),
  from: p.evmHex().notNull(),
  to: p.evmHex().notNull(),
}));
