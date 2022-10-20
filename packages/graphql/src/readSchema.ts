import type { PonderOptions } from "@ponder/ponder";
import { buildSchema, GraphQLSchema } from "graphql";
import { readFileSync } from "node:fs";

const schemaHeader = `
"Directs the executor to process this type as a Ponder entity."
directive @entity(immutable: Boolean = false) on OBJECT

"Creates a virtual field on the entity that may be queried but cannot be set manually through the mappings API."
directive @derivedFrom(field: String!) on FIELD_DEFINITION


scalar BigDecimal
scalar Bytes
scalar BigInt
`;

const readSchema = (options: PonderOptions): GraphQLSchema => {
  const schemaBody = readFileSync(options.SCHEMA_FILE_PATH);
  const schemaSource = schemaHeader + schemaBody.toString();
  const schema = buildSchema(schemaSource);

  return schema;
};

export { readSchema };
