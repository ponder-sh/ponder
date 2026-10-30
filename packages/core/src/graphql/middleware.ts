import { maxAliasesPlugin } from "@escape.tech/graphql-armor-max-aliases";
import { maxDepthPlugin } from "@escape.tech/graphql-armor-max-depth";
import { maxTokensPlugin } from "@escape.tech/graphql-armor-max-tokens";
import { Effect } from "effect";
import { type GraphQLSchema, printSchema } from "graphql";
import { createYoga } from "graphql-yoga";
import { createMiddleware } from "hono/factory";
import { Db } from "@/database/db.js";
import { graphiQLHtml } from "@/graphql/graphiql.html.js";
import type { Schema } from "@/internal/types.js";
import type { ReadonlyDrizzle } from "@/types/db.js";
import { buildDataLoaderCache, buildGraphQLSchema } from "./index.js";

/**
 * Middleware for GraphQL with an interactive web view.
 *
 * - Docs: https://ponder.sh/docs/api-reference/ponder/api-endpoints#graphql
 *
 * @example
 * import { db } from "ponder:api";
 * import schema from "ponder:schema";
 * import { graphql } from "@/index.js";
 * import { Hono } from "hono";
 *
 * const app = new Hono();
 *
 * app.use("/graphql", graphql({ db, schema }));
 *
 * export default app;
 *
 */
export const graphql = (
  { schema }: { db: ReadonlyDrizzle<Schema>; schema: Schema },
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
    // https://www.apollographql.com/blog/prevent-graph-misuse-with-operation-size-and-complexity-limits
    maxOperationTokens: 1000,
    maxOperationDepth: 100,
    maxOperationAliases: 30,
  },
) => {
  if (globalThis.PONDER_API_CONTEXT === undefined) {
    throw new Error(
      "graphql() middleware cannot be initialized outside of a Ponder project",
    );
  }

  return Effect.runSyncWith(globalThis.PONDER_API_CONTEXT)(
    makeGraphQL({
      schema,
      maxOperationTokens,
      maxOperationDepth,
      maxOperationAliases,
    }),
  );
};

/**
 * Create the GraphQL middleware, and write the GraphQL schema to
 * `generated/schema.graphql`.
 */
const makeGraphQL = ({
  schema,
  maxOperationTokens,
  maxOperationDepth,
  maxOperationAliases,
}: {
  schema: Schema;
  maxOperationTokens: number;
  maxOperationDepth: number;
  maxOperationAliases: number;
}) =>
  Effect.gen(function* () {
    const db = (yield* Db).readonly;
    const runPromise = Effect.runPromiseWith(yield* Effect.context<Db>());

    const graphqlSchema = buildGraphQLSchema({ schema });

    yield* Effect.forkScoped(
      generateSchema({ graphqlSchema }).pipe(Effect.ignore),
    );

    const yoga = createYoga({
      graphqlEndpoint: "*", // Disable built-in route validation, use Hono routing instead
      schema: graphqlSchema,
      context: () => {
        const getDataLoader = buildDataLoaderCache({ db, runPromise });

        return { db, runPromise, getDataLoader };
      },
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

    return createMiddleware(async (c) => {
      if (c.req.method === "GET") {
        return c.html(graphiQLHtml);
      }

      const response = await yoga.handle(c.req.raw);
      if (response.status === 200) return response;
      // set response status to 200, must construct a new response object because Response.status is readonly

      // TODO: Figure out why Yoga is returning 500 status codes for GraphQL errors.
      const body = response.body;
      const headers = new Headers(response.headers);
      return new Response(body, {
        status: 200,
        statusText: "OK",
        headers,
      });
    });
  });

/**
 * Write the GraphQL schema to `generated/schema.graphql`.
 */
const generateSchema = ({ graphqlSchema }: { graphqlSchema: GraphQLSchema }) =>
  Effect.gen(function* () {
    const fs = yield* Effect.promise(
      () => import(/* webpackIgnore: true */ "node:fs"),
    );
    const path = yield* Effect.promise(
      () => import(/* webpackIgnore: true */ "node:path"),
    );

    yield* Effect.try({
      try: () => {
        fs.mkdirSync(path.join(process.cwd(), "generated"), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(process.cwd(), "generated", "schema.graphql"),
          printSchema(graphqlSchema),
          "utf-8",
        );
      },
      catch: (error) => error,
    });

    yield* Effect.logDebug({
      msg: `Wrote file "generated/schema.graphql"`,
    });
  });
