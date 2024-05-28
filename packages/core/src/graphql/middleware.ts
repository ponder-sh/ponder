import type { Schema } from "@/schema/common.js";
import { graphqlServer } from "@hono/graphql-server";
import { buildGraphqlSchema } from "./buildGraphqlSchema.js";

export const createGraphQLMiddleware = ({
  schema,
}: { schema: Schema }): ReturnType<typeof graphqlServer> => {
  return graphqlServer({ schema: buildGraphqlSchema(schema) });
};
