import { maxAliasesPlugin } from "@escape.tech/graphql-armor-max-aliases";
import { maxDepthPlugin } from "@escape.tech/graphql-armor-max-depth";
import { maxTokensPlugin } from "@escape.tech/graphql-armor-max-tokens";
import { Effect } from "effect";
import { GraphQLError, type GraphQLSchema, printSchema } from "graphql";
import { createYoga, maskError, type Plugin } from "graphql-yoga";
import { createMiddleware } from "hono/factory";
import { Db, type DbClient } from "../database/db.js";
import type { Schema } from "../internal/types.js";
import type { ReadonlyDrizzle } from "../types/db.js";
import { getOperationRows } from "./cost.js";
import { graphiQLHtml } from "./graphiql.html.js";
import { buildDataLoaderCache, buildGraphQLSchema } from "./index.js";

export type GraphQLOptions = {
  /** Maximum number of tokens in an operation. Default: `1000`. */
  maxOperationTokens?: number;
  /** Maximum depth of an operation. Default: `100`. */
  maxOperationDepth?: number;
  /** Maximum number of aliases in an operation. Default: `30`. */
  maxOperationAliases?: number;
  /**
   * Maximum number of rows that an operation can select, where the `limit`
   * arguments of nested plural fields multiply. Default: `100_000`.
   */
  maxOperationRows?: number;
  /** Maximum size of a request body in bytes. Default: `1_048_576` (1 MiB). */
  maxRequestBodySize?: number;
};

// Note: The token, depth, and alias limits are from Apollo:
// https://www.apollographql.com/blog/prevent-graph-misuse-with-operation-size-and-complexity-limits
const defaultOptions = {
  maxOperationTokens: 1000,
  maxOperationDepth: 100,
  maxOperationAliases: 30,
  maxOperationRows: 100_000,
  maxRequestBodySize: 1_048_576,
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

    return createGraphQLMiddleware({
      yoga,
      maxRequestBodySize: options.maxRequestBodySize,
    });
  });

/**
 * Create the Hono middleware that serves GraphiQL for `GET` requests and
 * passes other requests to `yoga`.
 */
export const createGraphQLMiddleware = ({
  yoga,
  maxRequestBodySize,
}: {
  yoga: { handle: (request: Request) => Response | Promise<Response> };
  maxRequestBodySize: number;
}) => {
  return createMiddleware(async (c) => {
    if (c.req.method === "GET") {
      return c.html(graphiQLHtml);
    }

    const body = await readBody(c.req.raw, maxRequestBodySize);
    if (body === undefined) {
      return c.json(
        {
          errors: [
            {
              message: `Request body is larger than the maximum of ${maxRequestBodySize} bytes.`,
            },
          ],
        },
        413,
      );
    }

    return yoga.handle(
      new Request(c.req.raw.url, {
        method: c.req.raw.method,
        headers: c.req.raw.headers,
        // Note: A HEAD request can't have a body.
        body: c.req.method === "HEAD" ? undefined : body,
        signal: c.req.raw.signal,
      }),
    );
  });
};

/**
 * Read the body of `request` as text, or return `undefined` as soon as it is
 * larger than `maxSize` bytes.
 */
const readBody = async (
  request: Request,
  maxSize: number,
): Promise<string | undefined> => {
  const contentLength = Number(request.headers.get("content-length"));
  if (contentLength > maxSize) return undefined;
  if (request.body === null) return "";

  const decoder = new TextDecoder();
  let body = "";
  let size = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxSize) {
      await reader.cancel();
      return undefined;
    }
    body += decoder.decode(value, { stream: true });
  }
  return body + decoder.decode();
};

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
      maxRowsPlugin(options.maxOperationRows),
    ],
  });

/**
 * Reject operations that can select more than `maxRows` rows. This runs
 * before execution instead of during validation so that `limit` arguments
 * from variables count.
 */
const maxRowsPlugin = (maxRows: number): Plugin => ({
  onExecute: ({ args, setResultAndStopExecution }) => {
    const rows = getOperationRows(args);
    if (rows > maxRows) {
      setResultAndStopExecution({
        errors: [
          new GraphQLError(
            `Operation can select up to ${rows} rows, which is more than the maximum of ${maxRows}. Use smaller limit arguments for nested fields.`,
          ),
        ],
      });
    }
  },
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
