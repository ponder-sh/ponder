import { json, numeric, pgSchema } from "drizzle-orm/pg-core";

const offchainSchema = pgSchema("offchain");

// Note: right now it's impossible to import column types from "ponder"
// because it doesn't export cjs (which drizzle-kit requires).
//
// However, the ponder bigint and hex columns are simple aliases
// for numeric(78) and text respectively.

export const metadataTable = offchainSchema.table("metadata", {
  tokenId: numeric({ precision: 78, scale: 0 }).primaryKey(),
  metadata: json(),
});
