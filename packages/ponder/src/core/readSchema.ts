import { buildSchema, GraphQLSchema } from "graphql";
import { readFile } from "node:fs/promises";

import { CONFIG } from "@/common/config";

const schemaHeader = `
"Directs the executor to process this type as a Ponder entity."
directive @entity(immutable: Boolean = false) on OBJECT

"Creates a virtual field on the entity that may be queried but cannot be set manually through the mappings API."
directive @derivedFrom(field: String!) on FIELD_DEFINITION


scalar BigDecimal
scalar Bytes
scalar BigInt
`;

const readSchema = async (): Promise<GraphQLSchema> => {
  const schemaBody = await readFile(CONFIG.SCHEMA_FILE_PATH);
  const schemaSource = schemaHeader + schemaBody.toString();
  const schema = buildSchema(schemaSource);

  return schema;
};

export { readSchema };
