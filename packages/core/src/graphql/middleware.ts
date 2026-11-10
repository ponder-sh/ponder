import { maxAliasesPlugin } from "@escape.tech/graphql-armor-max-aliases";
import { maxDepthPlugin } from "@escape.tech/graphql-armor-max-depth";
import { maxTokensPlugin } from "@escape.tech/graphql-armor-max-tokens";
import { Effect } from "effect";
import { GraphQLError, type GraphQLSchema, printSchema } from "graphql";
import { createYoga, maskError } from "graphql-yoga";
import { createMiddleware } from "hono/factory";
import { Db, type DbClient } from "../database/db.js";
import type { Schema } from "../internal/types.js";
import type { ReadonlyDrizzle } from "../types/db.js";
import { graphiQLHtml } from "./graphiql.html.js";
import { buildDataLoaderCache, buildGraphQLSchema } from "./index.js";

export type GraphQLOptions = {
  /** Maximum number of tokens in an operation. Default: `1000`. */
  maxOperationTokens?: number;
  /** Maximum depth of an operation. Default: `100`. */
  maxOperationDepth?: number;
  /** Maximum number of aliases in an operation. Default: `30`. */
  maxOperationAliases?: number;
};

// Note: The token, depth, and alias limits are from Apollo:
// https://www.apollographql.com/blog/prevent-graph-misuse-with-operation-size-and-complexity-limits
const defaultOptions = {
  maxOperationTokens: 1000,
  maxOperationDepth: 100,
  maxOperationAliases: 30,
} satisfies Required<GraphQLOptions>;

/**
 * Middleware for GraphQL with an interactive web view.
 *
 * - Docs: https://ponder.sh/docs/api-reference/ponder/api-endpoints#graphql
 *
 * @example
 * import { db } from "ponder:api";
 * import schema from "ponder:schema";
 * import { graphql } from "../index.js";
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
  options: GraphQLOptions = {},
) => {
  if (globalThis.PONDER_API_CONTEXT === undefined) {
    throw new Error(
      "graphql() middleware cannot be initialized outside of a Ponder project",
    );
  }

  return Effect.runSyncWith(globalThis.PONDER_API_CONTEXT)(
    makeGraphQL({ schema, options: { ...defaultOptions, ...options } }),
  );
};

/**
 * Create the GraphQL middleware, and write the GraphQL schema to
 * `generated/schema.graphql`.
 */
const makeGraphQL = ({
  schema,
  options,
}: {
  schema: Schema;
  options: Required<GraphQLOptions>;
}) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<Db>();
    const db = (yield* Db).readonly;

    const graphqlSchema = buildGraphQLSchema({ schema });

    yield* Effect.forkScoped(
      generateSchema({ graphqlSchema }).pipe(Effect.ignore),
    );

    const yoga = createGraphQLHandler({
      graphqlSchema,
      db,
      runPromise: Effect.runPromiseWith(context),
      maskErrors: process.env.NODE_ENV === "production",
      onUnexpectedError: (error) =>
        Effect.runForkWith(context)(
          Effect.logWarning({ msg: "Failed to execute GraphQL query", error }),
        ),
      options,
    });

    return createGraphQLMiddleware({ yoga });
  });

/**
 * Create the Hono middleware that serves GraphiQL for `GET` requests and
 * passes other requests to `yoga`.
 */
export const createGraphQLMiddleware = ({
  yoga,
}: {
  yoga: { handle: (request: Request) => Response | Promise<Response> };
}) =>
  createMiddleware(async (c) => {
    if (c.req.method === "GET") {
      return c.html(graphiQLHtml);
    }

    return yoga.handle(c.req.raw);
  });

/**
 * Create the graphql-yoga server that executes GraphQL requests against
 * `graphqlSchema`.
 *
 * Errors that aren't `GraphQLError`s (e.g. database errors) are passed to
 * `onUnexpectedError`, and replaced with "Unexpected error." if `maskErrors`.
 */
export const createGraphQLHandler = ({
  graphqlSchema,
  db,
  runPromise,
  maskErrors,
  onUnexpectedError,
  options,
}: {
  graphqlSchema: GraphQLSchema;
  db: DbClient;
  runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  maskErrors: boolean;
  onUnexpectedError: (error: unknown) => void;
  options: Required<GraphQLOptions>;
}) =>
  createYoga({
    graphqlEndpoint: "*", // Disable built-in route validation, use Hono routing instead
    schema: graphqlSchema,
    context: () => ({
      db,
      runPromise,
      getDataLoader: buildDataLoaderCache({ db, runPromise }),
    }),
    maskedErrors: {
      maskError: (error, message) => {
        const originalError =
          error instanceof GraphQLError ? error.originalError : error;
        if (
          originalError === undefined ||
          originalError instanceof GraphQLError
        ) {
          return error as Error;
        }

        onUnexpectedError(originalError);
        return maskErrors ? maskError(error, message, false) : (error as Error);
      },
    },
    logging: false,
    graphiql: false,
    parserAndValidationCache: false,
    plugins: [
      maxTokensPlugin({ n: options.maxOperationTokens }),
      maxDepthPlugin({
        n: options.maxOperationDepth,
        ignoreIntrospection: false,
      }),
      maxAliasesPlugin({ n: options.maxOperationAliases, allowList: [] }),
    ],
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
