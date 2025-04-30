import {
  setupCleanup,
  setupCommon,
  setupDatabase,
  setupPonder,
} from "@/_test/setup.js";
import { onchainTable } from "@/drizzle/onchain.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import { Hono } from "hono";
import { beforeEach, expect, test } from "vitest";
import { graphql } from "./middleware.js";

beforeEach(setupCommon);
beforeEach(setupDatabase);
beforeEach(setupCleanup);

test("middleware serves request", async (context) => {
  const schema = {
    table: onchainTable("table", (t) => ({
      id: t.text().primaryKey(),
      string: t.text(),
      int: t.integer(),
      float: t.doublePrecision(),
      boolean: t.boolean(),
      hex: t.hex(),
      bigint: t.bigint(),
    })),
  };

  const app = await setupPonder(context, { schema });
  const indexingStore = createRealtimeIndexingStore(app);

  globalThis.PONDER_DATABASE = app.database;

  await indexingStore.insert(schema.table).values({
    id: "0",
    string: "0",
    int: 0,
    float: 0,
    boolean: false,
    hex: "0x0",
    bigint: 0n,
  });

  const hono = new Hono().use(
    "/graphql",
    graphql({ schema, db: app.database.qb.drizzleReadonly }),
  );

  const response = await hono.request("/graphql", {
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
});

test("middleware supports path other than /graphql using hono routing", async (context) => {
  const schema = {
    table: onchainTable("table", (t) => ({ id: t.text().primaryKey() })),
  };

  const app = await setupPonder(context, { schema });
  const indexingStore = createRealtimeIndexingStore(app);

  globalThis.PONDER_DATABASE = app.database;

  await indexingStore.insert(schema.table).values({
    id: "0",
  });

  const hono = new Hono().use(
    "/not-graphql/**",
    graphql({ schema, db: app.database.qb.drizzleReadonly }),
  );

  const response = await hono.request("/not-graphql/at-all", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `query { table(id: "0") { id } }`,
    }),
  });

  expect(response.status).toBe(200);

  expect(await response.json()).toMatchObject({
    data: { table: { id: "0" } },
  });
});

test("middleware throws error when extra filter is applied", async (context) => {
  const schema = {
    table: onchainTable("table", (t) => ({
      id: t.text().primaryKey(),
      string: t.text(),
      int: t.integer(),
      float: t.doublePrecision(),
      boolean: t.boolean(),
      hex: t.hex(),
      bigint: t.bigint(),
    })),
  };

  const app = await setupPonder(context, { schema });

  globalThis.PONDER_DATABASE = app.database;

  const hono = new Hono().use(
    "/graphql",
    graphql({ schema, db: app.database.qb.drizzleReadonly }),
  );

  const response = await hono.request("/graphql", {
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
});

test("graphQLMiddleware throws error for token limit", async (context) => {
  const schema = {
    table: onchainTable("table", (t) => ({
      id: t.text().primaryKey(),
    })),
  };

  const app = await setupPonder(context, { schema });

  globalThis.PONDER_DATABASE = app.database;

  const hono = new Hono().use(
    "/graphql",
    graphql(
      { schema, db: app.database.qb.drizzleReadonly },
      { maxOperationTokens: 3 },
    ),
  );

  const response = await hono.request("/graphql", {
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
});

test("graphQLMiddleware throws error for depth limit", async (context) => {
  const schema = {
    table: onchainTable("table", (t) => ({
      id: t.text().primaryKey(),
    })),
  };

  const app = await setupPonder(context, { schema });

  globalThis.PONDER_DATABASE = app.database;

  const hono = new Hono().use(
    "/graphql",
    graphql(
      { schema, db: app.database.qb.drizzleReadonly },
      { maxOperationDepth: 5 },
    ),
  );

  const response = await hono.request("/graphql", {
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
});

test("graphQLMiddleware throws error for max aliases", async (context) => {
  const schema = {
    table: onchainTable("table", (t) => ({
      id: t.text().primaryKey(),
    })),
  };

  const app = await setupPonder(context, { schema });

  globalThis.PONDER_DATABASE = app.database;

  const hono = new Hono().use(
    "/graphql",
    graphql(
      { schema, db: app.database.qb.drizzleReadonly },
      { maxOperationAliases: 2 },
    ),
  );

  const response = await hono.request("/graphql", {
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
});

test("graphQLMiddleware interactive", async (context) => {
  const schema = {};

  const app = await setupPonder(context, { schema });

  globalThis.PONDER_DATABASE = app.database;

  const hono = new Hono().use(
    "/graphql",
    graphql(
      { schema, db: app.database.qb.drizzleReadonly },
      { maxOperationAliases: 2 },
    ),
  );

  const response = await hono.request("/graphql");

  expect(response.status).toBe(200);
});
