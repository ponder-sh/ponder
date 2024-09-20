import { pgSchema, serial, text } from "drizzle-orm/pg-core";

export const offchainSchema = pgSchema("offchain");

export const metadata = offchainSchema.table("metadata", {
  id: serial("id").primaryKey(),
  value: text("value"),
});
