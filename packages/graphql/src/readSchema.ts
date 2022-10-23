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

const readSchema = (filePath: string): GraphQLSchema => {
  const schemaBody = readFileSync(filePath);
  const schemaSource = schemaHeader + schemaBody.toString();
  const schema = buildSchema(schemaSource);

  return schema;
};

export { readSchema };
