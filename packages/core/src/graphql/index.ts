import { graphiQLHtml } from "@/ui/graphiql.html.js";
import { maxAliasesPlugin } from "@escape.tech/graphql-armor-max-aliases";
import { maxDepthPlugin } from "@escape.tech/graphql-armor-max-depth";
import { maxTokensPlugin } from "@escape.tech/graphql-armor-max-tokens";
import { createYoga } from "graphql-yoga";
import { createMiddleware } from "hono/factory";
import { buildGraphQLSchema } from "./buildGraphqlSchema.js";
import { buildLoaderCache } from "./buildLoaderCache.js";

export const graphql = (
  {
    maxOperationTokens = 1000,
    maxOperationDepth = 100,
    maxOperationAliases = 30,
  }: {
    maxOperationTokens?: number;
    maxOperationDepth?: number;
    maxOperationAliases?: number;
  } = {
    // Default limits are from Apollo:
    // https://www.apollographql.com/blog/prevent-graph-misuse-with-operation-size-and-complexity-limit
    maxOperationTokens: 1000,
    maxOperationDepth: 100,
    maxOperationAliases: 30,
  },
) =>
  createMiddleware(async (c) => {
    const readonlyStore = c.get("readonlyStore");
    const metadataStore = c.get("metadataStore");
    const schema = c.get("schema");
    const graphqlSchema = buildGraphQLSchema(schema);

    if (c.req.method === "GET") {
      return c.html(graphiQLHtml(c.req.path));
    }

    const yoga = createYoga({
      schema: graphqlSchema,
      context: () => {
        const getLoader = buildLoaderCache({ store: readonlyStore });
        return { readonlyStore, metadataStore, getLoader };
      },
      graphqlEndpoint: c.req.path,
      maskedErrors: process.env.NODE_ENV === "production",
      logging: false,
      graphiql: false,
      parserAndValidationCache: false,
      plugins: [
        maxTokensPlugin({ n: maxOperationTokens }),
        maxDepthPlugin({
          n: maxOperationDepth,
          ignoreIntrospection: false,
        }),
        maxAliasesPlugin({
          n: maxOperationAliases,
          allowList: [],
        }),
      ],
    });

    return yoga.handle(c.req.raw);
  });
