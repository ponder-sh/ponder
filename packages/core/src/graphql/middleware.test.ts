import { expect, test } from "bun:test";
import { relations } from "drizzle-orm";
import { Effect } from "effect";
import { parse } from "graphql";
import { Hono } from "hono";
import { createTestDb } from "../_test/graphql.js";
import { onchainTable } from "../drizzle/onchain.js";
import type { Schema } from "../internal/types.js";
import { buildGraphQLSchema } from "./index.js";
import { getOperationRows } from "./limits.js";
import {
  createGraphQLHandler,
  createGraphQLMiddleware,
  type GraphQLOptions,
} from "./middleware.js";

const user = onchainTable("user", (t) => ({ id: t.text().primaryKey() }));
const post = onchainTable("post", (t) => ({
  id: t.text().primaryKey(),
  authorId: t.text().notNull(),
}));
const userRelations = relations(user, ({ many }) => ({
  posts: many(post),
}));
const postRelations = relations(post, ({ one }) => ({
  author: one(user, { fields: [post.authorId], references: [user.id] }),
}));
const schema = { user, post, userRelations, postRelations };

/**
 * Serves GraphQL requests for `schema` without a database. See `createTestDb`.
 */
const createServer = ({
  rows,
  maskErrors = false,
  options,
}: {
  rows?: Parameters<typeof createTestDb>[1];
  maskErrors?: boolean;
  options?: GraphQLOptions;
} = {}) => {
  const { db, queries } = createTestDb(schema as Schema, rows);
  const unexpectedErrors: unknown[] = [];
  const yoga = createGraphQLHandler({
    graphqlSchema: buildGraphQLSchema({ schema: schema as Schema }),
    db,
    runPromise: Effect.runPromise,
    maskErrors,
    onUnexpectedError: (error) => unexpectedErrors.push(error),
    options: {
      maxOperationTokens: 1000,
      maxOperationDepth: 100,
      maxOperationAliases: 30,
      maxOperationRows: 100_000,
      maxRequestBodySize: 1_048_576,
      ...options,
    },
  });
  const app = new Hono().use(
    "/graphql",
    createGraphQLMiddleware({
      yoga,
      maxRequestBodySize: options?.maxRequestBodySize ?? 1_048_576,
    }),
  );

  const request = async (
    body: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await app.request("/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : text };
  };

  return { request, queries, unexpectedErrors };
};

test("status codes", async () => {
  const { request } = createServer();

  expect([
    await request({ query: "{ users { items { id } } }" }),
    await request({ query: "{ nope }" }),
    await request(
      { query: "{ nope }" },
      { accept: "application/graphql-response+json" },
    ),
    await request("not json"),
  ]).toMatchInlineSnapshot(`
    [
      {
        "body": {
          "data": {
            "users": {
              "items": [],
            },
          },
        },
        "status": 200,
      },
      {
        "body": {
          "errors": [
            {
              "extensions": {
                "code": "GRAPHQL_VALIDATION_FAILED",
              },
              "locations": [
                {
                  "column": 3,
                  "line": 1,
                },
              ],
              "message": "Cannot query field "nope" on type "Query".",
            },
          ],
        },
        "status": 200,
      },
      {
        "body": {
          "errors": [
            {
              "extensions": {
                "code": "GRAPHQL_VALIDATION_FAILED",
              },
              "locations": [
                {
                  "column": 3,
                  "line": 1,
                },
              ],
              "message": "Cannot query field "nope" on type "Query".",
            },
          ],
        },
        "status": 400,
      },
      {
        "body": {
          "errors": [
            {
              "extensions": {
                "code": "BAD_REQUEST",
                "originalError": {
                  "message": "JSON Parse error: Unexpected identifier "not"",
                  "name": "SyntaxError",
                },
              },
              "message": "POST body sent invalid JSON.",
            },
          ],
        },
        "status": 400,
      },
    ]
  `);
});

test("unexpected errors are reported and masked in production", async () => {
  const rows = () => {
    throw new Error('relation "user" does not exist');
  };

  const snapshots = [];
  for (const maskErrors of [false, true]) {
    const { request, unexpectedErrors } = createServer({ rows, maskErrors });
    const results = [
      await request({ query: "{ users { items { id } } }" }),
      // Note: GraphQL errors from user input are not unexpected.
      await request({ query: "{ users(limit: -1) { items { id } } }" }),
    ];
    snapshots.push({
      maskErrors,
      results,
      unexpectedErrors: unexpectedErrors.map((error) => String(error)),
    });
  }
  expect(snapshots).toMatchInlineSnapshot(`
    [
      {
        "maskErrors": false,
        "results": [
          {
            "body": {
              "data": null,
              "errors": [
                {
                  "locations": [
                    {
                      "column": 3,
                      "line": 1,
                    },
                  ],
                  "message": "relation "user" does not exist",
                  "path": [
                    "users",
                  ],
                },
              ],
            },
            "status": 200,
          },
          {
            "body": {
              "data": null,
              "errors": [
                {
                  "locations": [
                    {
                      "column": 3,
                      "line": 1,
                    },
                  ],
                  "message": "Invalid limit. Got -1, expected >=0.",
                  "path": [
                    "users",
                  ],
                },
              ],
            },
            "status": 200,
          },
        ],
        "unexpectedErrors": [
          "Error: relation "user" does not exist",
        ],
      },
      {
        "maskErrors": true,
        "results": [
          {
            "body": {
              "data": null,
              "errors": [
                {
                  "extensions": {
                    "code": "INTERNAL_SERVER_ERROR",
                  },
                  "locations": [
                    {
                      "column": 3,
                      "line": 1,
                    },
                  ],
                  "message": "Unexpected error.",
                  "path": [
                    "users",
                  ],
                },
              ],
            },
            "status": 200,
          },
          {
            "body": {
              "data": null,
              "errors": [
                {
                  "locations": [
                    {
                      "column": 3,
                      "line": 1,
                    },
                  ],
                  "message": "Invalid limit. Got -1, expected >=0.",
                  "path": [
                    "users",
                  ],
                },
              ],
            },
            "status": 200,
          },
        ],
        "unexpectedErrors": [
          "Error: relation "user" does not exist",
        ],
      },
    ]
  `);
});

test("operation rows", () => {
  const graphqlSchema = buildGraphQLSchema({ schema: schema as Schema });
  const rows = (query: string, variableValues?: Record<string, unknown>) =>
    getOperationRows({
      schema: graphqlSchema,
      document: parse(query),
      variableValues,
    });

  expect({
    default: rows("{ users { items { id } } }"),
    limit: rows("{ users(limit: 1000) { items { id } } }"),
    totalCount: rows("{ users(limit: 10) { totalCount } }"),
    singular: rows(`{ user(id: "a") { id } }`),
    nested: rows(
      "{ users(limit: 10) { items { posts(limit: 20) { items { author { id } } } } } }",
    ),
    variables: rows(
      "query ($n: Int) { users(limit: $n) { items { posts { items { id } } } } }",
      { n: 100 },
    ),
    fragments: rows(
      "{ a: users(limit: 2) { ...page } b: users(limit: 3) { ...page } } fragment page on userPage { items { ... on user { posts(limit: 10) { items { id } } } } }",
    ),
    // Note: Limits above the maximum fail in the resolver.
    aboveMaximum: rows("{ users(limit: 5000) { items { id } } }"),
    introspection: rows("{ __schema { types { name } } }"),
  }).toMatchInlineSnapshot(`
    {
      "aboveMaximum": 1000,
      "default": 50,
      "fragments": 55,
      "introspection": 0,
      "limit": 1000,
      "nested": 410,
      "singular": 1,
      "totalCount": 11,
      "variables": 5100,
    }
  `);
});

test("max operation rows", async () => {
  const { request, queries } = createServer();

  const nested = (n: number) =>
    `{ users(limit: ${n}) { items { posts(limit: ${n}) { totalCount items { author { posts(limit: ${n}) { items { id } } } } } } } }`;

  expect([
    await request({ query: nested(20) }),
    await request({ query: nested(50) }),
    await request({
      query:
        "query ($n: Int) { users(limit: $n) { items { posts(limit: $n) { items { id } } } } }",
      variables: { n: 1000 },
    }),
  ]).toMatchInlineSnapshot(`
    [
      {
        "body": {
          "data": {
            "users": {
              "items": [],
            },
          },
        },
        "status": 200,
      },
      {
        "body": {
          "errors": [
            {
              "message": "Operation can select up to 130100 rows, which is more than the maximum of 100000. Use smaller limit arguments for nested fields.",
            },
          ],
        },
        "status": 200,
      },
      {
        "body": {
          "errors": [
            {
              "message": "Operation can select up to 1001000 rows, which is more than the maximum of 100000. Use smaller limit arguments for nested fields.",
            },
          ],
        },
        "status": 200,
      },
    ]
  `);
  expect(queries.length).toMatchInlineSnapshot(`1`);
});

test("max request body size", async () => {
  const { request, queries } = createServer({
    options: { maxRequestBodySize: 100 },
  });

  expect(
    await request({
      query:
        "query ($ids: [String]) { users(where: { id_in: $ids }) { items { id } } }",
      variables: { ids: Array.from({ length: 100 }, (_, i) => String(i)) },
    }),
  ).toMatchInlineSnapshot(`
    {
      "body": {
        "errors": [
          {
            "message": "Request body is larger than the maximum of 100 bytes.",
          },
        ],
      },
      "status": 413,
    }
  `);
  expect(queries).toEqual([]);
});

test("max operation tokens, depth, and aliases", async () => {
  const { request, queries } = createServer({
    options: {
      maxOperationTokens: 40,
      maxOperationDepth: 5,
      maxOperationAliases: 2,
    },
  });

  const results = await Promise.all(
    [
      // depth 5
      "{ users { items { posts { items { id } } } } }",
      // Note: A fragment counts at the depth where it is spread.
      "{ users { items { ...user } } } fragment user on user { posts { items { author { id } } } }",
      // 2 aliases
      "{ a: users { items { id } } b: users { items { id } } }",
      // Note: Aliases in a fragment count once for each spread.
      "{ users { items { ...user } } a: users { items { ...user } } } fragment user on user { b: id }",
      "{ users { items { id id id id id id id id id id id id id id id id id id id id id id id id id id id id id id id id id id id id } } }",
    ].map((query) => request({ query })),
  );
  expect(
    results.map(({ status, body }) => ({
      status,
      errors: body.errors?.map((error: { message: string }) => error.message),
    })),
  ).toMatchInlineSnapshot(`
    [
      {
        "errors": undefined,
        "status": 200,
      },
      {
        "errors": [
          "Operation has a depth of 6, which is more than the maximum of 5.",
        ],
        "status": 200,
      },
      {
        "errors": undefined,
        "status": 200,
      },
      {
        "errors": [
          "Operation has 3 aliases, which is more than the maximum of 2.",
        ],
        "status": 200,
      },
      {
        "errors": [
          "Syntax Error: Document contains more that 40 tokens. Parsing aborted.",
        ],
        "status": 200,
      },
    ]
  `);
  expect(queries.length).toMatchInlineSnapshot(`3`);
});

test("limits apply to cached documents", async () => {
  const { request } = createServer({
    options: { maxOperationTokens: 20, maxOperationDepth: 3 },
  });

  const errors = async (query: string) =>
    (await request({ query })).body.errors?.map(
      (error: { message: string }) => error.message,
    );

  // Note: The second request of each document hits the parser cache.
  for (const query of [
    "{ users { items { posts { items { id } } } } }",
    "{ users { items { id id id id id id id id id id id id id id id id } } }",
  ]) {
    expect(await errors(query)).toEqual(await errors(query));
    expect(await errors(query)).toHaveLength(1);
  }
});
