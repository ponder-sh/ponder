import { Table, is, relations } from "drizzle-orm";
import * as _ponderSchema from "../../ponder/ponder.schema";
import * as offchainSchema from "./offchain";

// Note: We need a separate file for merging the schemas because
// "ponder.schema" can't be executed by drizzle-kit, and we also
// don't want drizzle to generate migrations for onchain tables.

// Note: `_ponderSchema` doesn't have information about which database schema
// to use, so we need to set it manually.

const setDatabaseSchema = <T extends { [name: string]: unknown }>(
  schema: T,
  schemaName: string,
): T => {
  for (const table of Object.values(schema)) {
    if (is(table, Table)) {
      table[Symbol.for("drizzle:Schema")] = schemaName;
    }
  }
  return schema;
};

const ponderSchema = setDatabaseSchema(_ponderSchema, "prod");

export const metadataRelations = relations(
  offchainSchema.metadataTable,
  ({ one }) => ({
    token: one(ponderSchema.token, {
      fields: [offchainSchema.metadataTable.tokenId],
      references: [ponderSchema.token.id],
    }),
  }),
);

export const schema = {
  ...offchainSchema,
  ...ponderSchema,
  metadataRelations,
};
