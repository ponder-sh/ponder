import { onchainTable } from "@ponder/core";

export const chainlinkPrice = onchainTable("chainlink_price", (p) => ({
  timestamp: p.bigint().primaryKey(),
  price: p.doublePrecision().notNull(),
}));
