import { setDatabaseSchema } from "@ponder/client";
import { relations } from "drizzle-orm";
import * as ponderSchema from "../ponder.schema";
import * as offchainSchema from "./offchain.schema";

// Note: We need a separate file for merging the schemas because
// "ponder.schema" can't be executed by drizzle-kit, and we also
// don't want drizzle to generate migrations for onchain tables.

// Note: `ponderSchema` doesn't have information about which database schema
// to use, so we need to set it with the `setDatabaseSchema` function.

// setDatabaseSchema(ponderSchema, "prod");

// export const accountMetadataRelations = relations(
//   offchainSchema.accountMetadata,
//   ({ one }) => ({
//     token: one(ponderSchema.token, {
//       fields: [offchainSchema.metadataTable.tokenId],
//       references: [ponderSchema.token.id],
//     }),
//   }),
// );

export * from "../ponder.schema";
export * from "./offchain.schema";
