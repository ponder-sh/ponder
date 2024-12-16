import type { Schema } from "@/drizzle/index.js";
import { printSchema } from "graphql";
import { buildGraphQLSchema } from "./index.js";

export const printGraphqlSchema = (schema: Schema) => {
  const graphqlSchema = buildGraphQLSchema(schema);
  return printSchema(graphqlSchema);
};
