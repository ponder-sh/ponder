import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { onchainTable } from "@/drizzle/drizzle.js";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { beforeEach, expect, test, vi } from "vitest";
import { graphql } from "./middleware.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

vi.mock("@/generated", async () => {
  return {
    instanceId: "1234",
  };
});

test("middleware serves request", async (context) => {
  const schema = {
    table: onchainTable("table", (t) => ({
      id: t.text().primaryKey(),
      string: t.text(),
      int: t.integer(),
      float: t.doublePrecision(),
      boolean: t.boolean(),
      hex: t.evmHex(),
      bigint: t.evmBigint(),
    })),
  };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });

  const contextMiddleware = createMiddleware(async (c, next) => {
    c.set("common", context.common);
    c.set("db", database.drizzle);
    c.set("metadataStore", metadataStore);
    await next();
  });

  await indexingStore.insert(schema.table).values({
    id: "0",
    string: "0",
    int: 0,
    float: 0,
    boolean: false,
    hex: "0x0",
    bigint: 0n,
  });
  await indexingStore.flush();

  const app = new Hono().use(contextMiddleware).use("/graphql", graphql());

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

test("middleware throws error when extra filter is applied", async (context) => {
  const schema = {
    table: onchainTable("table", (t) => ({
      id: t.text().primaryKey(),
      string: t.text(),
      int: t.integer(),
      float: t.doublePrecision(),
      boolean: t.boolean(),
      hex: t.evmHex(),
      bigint: t.evmBigint(),
    })),
  };

  const { database, metadataStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const contextMiddleware = createMiddleware(async (c, next) => {
    c.set("common", context.common);
    c.set("db", database.drizzle);
    c.set("metadataStore", metadataStore);
    await next();
  });

  const app = new Hono().use(contextMiddleware).use("/graphql", graphql());

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
  const schema = {
    table: onchainTable("table", (t) => ({
      id: t.text().primaryKey(),
    })),
  };

  const { database, metadataStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const contextMiddleware = createMiddleware(async (c, next) => {
    c.set("common", context.common);
    c.set("db", database.drizzle);
    c.set("metadataStore", metadataStore);
    await next();
  });

  const app = new Hono()
    .use(contextMiddleware)
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
  const schema = {
    table: onchainTable("table", (t) => ({
      id: t.text().primaryKey(),
    })),
  };

  const { database, metadataStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const contextMiddleware = createMiddleware(async (c, next) => {
    c.set("common", context.common);
    c.set("db", database.drizzle);
    c.set("metadataStore", metadataStore);
    await next();
  });

  const app = new Hono()
    .use(contextMiddleware)
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
  const schema = {
    table: onchainTable("table", (t) => ({
      id: t.text().primaryKey(),
    })),
  };

  const { database, metadataStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const contextMiddleware = createMiddleware(async (c, next) => {
    c.set("common", context.common);
    c.set("db", database.drizzle);
    c.set("metadataStore", metadataStore);
    await next();
  });

  const app = new Hono()
    .use(contextMiddleware)
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
  const { database, metadataStore, cleanup } = await setupDatabaseServices(
    context,
    { schema: {} },
  );

  const contextMiddleware = createMiddleware(async (c, next) => {
    c.set("common", context.common);
    c.set("db", database.drizzle);
    c.set("metadataStore", metadataStore);
    await next();
  });

  const app = new Hono()
    .use(contextMiddleware)
    .use("/graphql", graphql({ maxOperationAliases: 2 }));

  const response = await app.request("/graphql");

  expect(response.status).toBe(200);

  await cleanup();
});
