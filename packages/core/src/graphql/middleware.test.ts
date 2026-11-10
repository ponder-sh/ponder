import { expect, test } from "bun:test";
import { relations } from "drizzle-orm";
import { Effect } from "effect";
import { Hono } from "hono";
import { createTestDb } from "../_test/graphql.js";
import { onchainTable } from "../drizzle/onchain.js";
import type { Schema } from "../internal/types.js";
import { buildGraphQLSchema } from "./index.js";
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
      ...options,
    },
  });
  const app = new Hono().use("/graphql", createGraphQLMiddleware({ yoga }));

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
