import { buildSchema, GraphQLSchema } from "graphql";
import fs from "node:fs/promises";

import { CONFIG } from "./config";

const schemaHeader = `
"Directs the executor to process this type as a Ponder entity."
directive @entity(
  immutable: Boolean = false
) on OBJECT
`;

const readUserSchema = async (): Promise<GraphQLSchema> => {
  const schemaBody = await fs.readFile(CONFIG.userSchemaFile);
  const schemaSource = schemaHeader + schemaBody.toString();
  const schema = buildSchema(schemaSource);

  return schema;
};

export { readUserSchema };
