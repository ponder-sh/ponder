import { buildSchema } from "graphql";
import { readFileSync } from "node:fs";

import { PonderOptions } from "@/config/options";

const schemaHeader = `
"Directs the executor to process this type as a Ponder entity."
directive @entity(immutable: Boolean = false) on OBJECT

"Creates a virtual field on the entity that may be queried but cannot be set manually through the mappings API."
directive @derivedFrom(field: String!) on FIELD_DEFINITION


scalar BigDecimal
scalar Bytes
scalar BigInt
`;

export const readGraphqlSchema = ({ options }: { options: PonderOptions }) => {
  const schemaBody = readFileSync(options.SCHEMA_FILE_PATH);
  const schemaSource = schemaHeader + schemaBody.toString();

  const schema = buildSchema(schemaSource);
  return schema;
};
