import { ponderHex } from "@ponder/core";
import { pgSchema, serial } from "drizzle-orm/pg-core";

export const offchainSchema = pgSchema("offchain");

export const metadata = offchainSchema.table("metadata", {
  id: serial("id").primaryKey(),
  account: ponderHex("account").notNull(),
});
