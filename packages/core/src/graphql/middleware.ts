import type { ReadonlyStore } from "@/indexing-store/store.js";
import { createYoga } from "graphql-yoga";
import { createMiddleware } from "hono/factory";
import { buildGraphqlSchema } from "./buildGraphqlSchema.js";
import { buildLoaderCache } from "./buildLoaderCache.js";

export const graphQLMiddleware = createMiddleware(async (c) => {
  const db = c.get("db");
  const schema = c.get("schema");
  const graphqlSchema = buildGraphqlSchema(schema);

  const readonlyStore = db as unknown as ReadonlyStore;

  const yoga = createYoga({
    schema: graphqlSchema,
    context: () => {
      const getLoader = buildLoaderCache({ store: readonlyStore });
      return { store: readonlyStore, getLoader };
    },
    graphqlEndpoint: "/",
    maskedErrors: process.env.NODE_ENV === "production",
    logging: false,
    graphiql: false,
    parserAndValidationCache: false,
    // plugins: [
    //   maxTokensPlugin({ n: common.options.graphqlMaxOperationTokens }),
    //   maxDepthPlugin({
    //     n: common.options.graphqlMaxOperationDepth,
    //     ignoreIntrospection: false,
    //   }),
    //   maxAliasesPlugin({
    //     n: common.options.graphqlMaxOperationAliases,
    //     allowList: [],
    //   }),
    // ],
  });

  return yoga.handle(c.req.raw);
});
