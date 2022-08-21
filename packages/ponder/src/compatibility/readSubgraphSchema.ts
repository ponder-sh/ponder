import { buildSchema, GraphQLSchema } from "graphql";
import { readFile } from "node:fs/promises";

const schemaHeader = `
"Directs the executor to process this type as a ponder entity."
directive @entity(
  immutable: Boolean = false
) on OBJECT

scalar BigDecimal
scalar Bytes
scalar BigInt
`;

const readSubgraphSchema = async (filePath: string): Promise<GraphQLSchema> => {
  const schemaBody = await readFile(filePath);
  const schemaSource = schemaHeader + schemaBody.toString();
  const schema = buildSchema(schemaSource);

  return schema;
};

export { readSubgraphSchema };
