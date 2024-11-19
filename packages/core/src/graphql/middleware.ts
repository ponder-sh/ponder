import { graphiQLHtml } from "@/ui/graphiql.html.js";
import { maxAliasesPlugin } from "@escape.tech/graphql-armor-max-aliases";
import { maxDepthPlugin } from "@escape.tech/graphql-armor-max-depth";
import { maxTokensPlugin } from "@escape.tech/graphql-armor-max-tokens";
import { type YogaServerInstance, createYoga } from "graphql-yoga";
import { createMiddleware } from "hono/factory";
import { buildDataLoaderCache } from "./index.js";

/**
 * Middleware for GraphQL with an interactive web view.
 *
 * - Docs: https://ponder.sh/docs/query/api-functions#register-graphql-middleware
 *
 * @example
 * import { ponder } from "@/generated";
 * import { graphql } from "@ponder/core";
 *
 * ponder.use("/graphql", graphql());
 *
 */
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
) => {
  let yoga: YogaServerInstance<any, any> | undefined = undefined;

  return createMiddleware(async (c) => {
    if (c.req.method === "GET") {
      return c.html(graphiQLHtml(c.req.path));
    }

    if (yoga === undefined) {
      const metadataStore = c.get("metadataStore");
      const graphqlSchema = c.get("graphqlSchema");
      const drizzle = c.get("db");

      yoga = createYoga({
        schema: graphqlSchema,
        context: () => {
          const getDataLoader = buildDataLoaderCache({ drizzle });
          return { drizzle, metadataStore, getDataLoader };
        },
        graphqlEndpoint: c.req.path,
        maskedErrors: process.env.NODE_ENV === "production",
        logging: false,
        graphiql: false,
        parserAndValidationCache: false,
        plugins: [
          maxTokensPlugin({ n: maxOperationTokens }),
          maxDepthPlugin({ n: maxOperationDepth, ignoreIntrospection: false }),
          maxAliasesPlugin({ n: maxOperationAliases, allowList: [] }),
        ],
      });
    }

    const response = await yoga.handle(c.req.raw);
    // TODO: Figure out why Yoga is returning 500 status codes for GraphQL errors.
    // @ts-expect-error
    response.status = 200;
    // @ts-expect-error
    response.statusText = "OK";

    return response;
  });
};
