import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import type { HistoricalStore, ReadonlyStore } from "@/indexing-store/store.js";
import type { Schema } from "@/schema/common.js";
import { createSchema } from "@/schema/schema.js";
import { encodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { beforeEach, expect, test } from "vitest";
import { graphql } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

const contextMiddleware = (schema: Schema, readonlyStore: ReadonlyStore) =>
  createMiddleware(async (c, next) => {
    c.set("readonlyStore", readonlyStore);
    c.set("schema", schema);
    await next();
  });

test("graphQLMiddleware serves request", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, readonlyStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      string: "0",
      int: 0,
      float: 0,
      boolean: false,
      hex: "0x0",
      bigint: 0n,
    },
  });

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const app = new Hono()
    .use(contextMiddleware(schema, readonlyStore))
    .use("/graphql", graphql());

  const response = await app.request("/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `
      query {
        table(id: "0") {
          id
          string
          int
          float
          boolean
          hex
          bigint
        }
      }
    `,
    }),
  });

  expect(response.status).toBe(200);

  expect(await response.json()).toMatchObject({
    data: {
      table: {
        id: "0",
        string: "0",
        int: 0,
        float: 0,
        boolean: false,
        hex: "0x00",
        bigint: "0",
      },
    },
  });

  await cleanup();
});

test("graphQLMiddleware throws error when extra filter is applied", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { readonlyStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  const app = new Hono()
    .use(contextMiddleware(schema, readonlyStore))
    .use("/graphql", graphql());

  const response = await app.request("/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `
        {
          table(id: "0", doesntExist: "kevin") {
            id
            string
            int
            float
            boolean
            hex
            bigint
          }
        }
      `,
    }),
  });

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.errors[0].message).toBe(
    'Unknown argument "doesntExist" on field "Query.table".',
  );

  await cleanup();
});

test("graphQLMiddleware throws error for token limit", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({ id: p.string() }),
  }));

  const { readonlyStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  const app = new Hono()
    .use(contextMiddleware(schema, readonlyStore))
    .use("/graphql", graphql({ maxOperationTokens: 3 }));

  const response = await app.request("/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `
        {
          __schema {
            types {
              fields {
                type {
                  fields {
                    type {
                      description
                    }              
                  }
                }
              }
            }
          }
        }
      `,
    }),
  });

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.errors[0].message).toBe(
    "Syntax Error: Token limit of 3 exceeded.",
  );

  await cleanup();
});

test("graphQLMiddleware throws error for depth limit", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({ id: p.string() }),
  }));

  const { readonlyStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  const app = new Hono()
    .use(contextMiddleware(schema, readonlyStore))
    .use("/graphql", graphql({ maxOperationDepth: 5 }));

  const response = await app.request("/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `
        {
          __schema {
            types {
              fields {
                type {
                  fields {
                    type {
                      description
                    }              
                  }
                }
              }
            }
          }
        }
      `,
    }),
  });

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.errors[0].message).toBe(
    "Syntax Error: Query depth limit of 5 exceeded, found 7.",
  );

  await cleanup();
});

test("graphQLMiddleware throws error for max aliases", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({ id: p.string() }),
  }));

  const { readonlyStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  const app = new Hono()
    .use(contextMiddleware(schema, readonlyStore))
    .use("/graphql", graphql({ maxOperationAliases: 2 }));

  const response = await app.request("/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `
        {
          __schema {
            types {
              fields {
                type {
                  alias1: fields {
                    type {
                      description
                    }
                  }
                  alias2: fields {
                    type {
                      description
                    }
                  }
                  alias3: fields {
                    type {
                      description
                    }
                  }
                }
              }
            }
          }
        }
      `,
    }),
  });

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.errors[0].message).toBe(
    "Syntax Error: Aliases limit of 2 exceeded, found 3.",
  );

  await cleanup();
});

test("graphQLMiddleware interactive", async (context) => {
  const { readonlyStore, cleanup } = await setupDatabaseServices(context, {
    schema: {},
  });

  const app = new Hono()
    .use(contextMiddleware({}, readonlyStore))
    .use("/graphql", graphql({ maxOperationAliases: 2 }));

  const response = await app.request("/graphql");

  expect(response.status).toBe(200);

  await cleanup();
});
