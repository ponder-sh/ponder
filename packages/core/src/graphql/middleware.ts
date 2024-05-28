import type { Schema } from "@/schema/common.js";
import { graphqlServer } from "@hono/graphql-server";
import { buildGraphqlSchema } from "./buildGraphqlSchema.js";

// @ts-ignore
export function GraphQLServer(): ReturnType<typeof graphqlServer>;
export function GraphQLServer({
  schema,
}: { schema: Schema }): ReturnType<typeof graphqlServer> {
  return graphqlServer({ schema: buildGraphqlSchema(schema) });
}
