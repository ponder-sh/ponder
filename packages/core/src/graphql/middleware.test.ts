import {
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { onchainTable } from "@/drizzle/onchain.js";
import { Hono } from "hono";
import { beforeEach, expect, test } from "vitest";
import { graphql } from "./middleware.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);
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

  const { database, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  globalThis.PONDER_DATABASE = database;

  await indexingStore.insert(schema.table).values({
    id: "0",
    string: "0",
    int: 0,
    float: 0,
    boolean: false,
    hex: "0x0",
    bigint: 0n,
  });

  const app = new Hono().use(
    "/graphql",
    graphql({ schema, db: database.readonlyQB }),
  );

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
});

test("middleware supports path other than /graphql using hono routing", async (context) => {
  const schema = {
    table: onchainTable("table", (t) => ({ id: t.text().primaryKey() })),
  };

  const { database, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  globalThis.PONDER_DATABASE = database;

  await indexingStore.insert(schema.table).values({
    id: "0",
  });

  const app = new Hono().use(
    "/not-graphql/**",
    graphql({ schema, db: database.readonlyQB }),
  );

  const response = await app.request("/not-graphql/at-all", {
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

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  globalThis.PONDER_DATABASE = database;

  const app = new Hono().use(
    "/graphql",
    graphql({ schema, db: database.readonlyQB }),
  );

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
});

test("graphQLMiddleware throws error for token limit", async (context) => {
  const schema = {
    table: onchainTable("table", (t) => ({
      id: t.text().primaryKey(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  globalThis.PONDER_DATABASE = database;

  const app = new Hono().use(
    "/graphql",
    graphql({ schema, db: database.readonlyQB }, { maxOperationTokens: 3 }),
  );

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
});

test("graphQLMiddleware throws error for depth limit", async (context) => {
  const schema = {
    table: onchainTable("table", (t) => ({
      id: t.text().primaryKey(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  globalThis.PONDER_DATABASE = database;

  const app = new Hono().use(
    "/graphql",
    graphql({ schema, db: database.readonlyQB }, { maxOperationDepth: 5 }),
  );

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
});

test("graphQLMiddleware throws error for max aliases", async (context) => {
  const schema = {
    table: onchainTable("table", (t) => ({
      id: t.text().primaryKey(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  globalThis.PONDER_DATABASE = database;

  const app = new Hono().use(
    "/graphql",
    graphql({ schema, db: database.readonlyQB }, { maxOperationAliases: 2 }),
  );

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
});

test("graphQLMiddleware interactive", async (context) => {
  const schema = {};

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  globalThis.PONDER_DATABASE = database;

  const app = new Hono().use(
    "/graphql",
    graphql({ schema, db: database.readonlyQB }, { maxOperationAliases: 2 }),
  );

  const response = await app.request("/graphql");

  expect(response.status).toBe(200);
});
