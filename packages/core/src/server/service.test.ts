import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import type { ReadonlyStore } from "@/indexing-store/store.js";
import { createSchema } from "@/schema/schema.js";
import { encodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import type { GraphQLSchema } from "graphql";
import { beforeEach, expect, test, vi } from "vitest";
import { buildGraphqlSchema } from "./graphql/buildGraphqlSchema.js";
import { createServer } from "./service.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

test("port", async (context) => {
  const server1 = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: context.common,
    readonlyStore: {} as ReadonlyStore,
  });

  const server2 = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: context.common,
    readonlyStore: {} as ReadonlyStore,
  });

  expect(server2.port).toBe(server1.port + 1);

  await server1.kill();
  await server2.kill();
});

test("not healthy", async (context) => {
  const server = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: {
      ...context.common,
      options: { ...context.common.options, maxHealthcheckDuration: 5 },
    },
    readonlyStore: {} as ReadonlyStore,
  });

  const response = await server.hono.request("/health");

  expect(response.status).toBe(503);

  await server.kill();
});

test("healthy", async (context) => {
  const server = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: {
      ...context.common,
      options: { ...context.common.options, maxHealthcheckDuration: 0 },
    },
    readonlyStore: {} as ReadonlyStore,
  });

  const response = await server.hono.request("/health");

  expect(response.status).toBe(200);

  await server.kill();
});

test("healthy PUT", async (context) => {
  const server = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: {
      ...context.common,
      options: { ...context.common.options, maxHealthcheckDuration: 0 },
    },
    readonlyStore: {} as ReadonlyStore,
  });

  const response = await server.hono.request("/health", { method: "PUT" });

  expect(response.status).toBe(404);

  await server.kill();
});

test("metrics", async (context) => {
  const server = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: context.common,
    readonlyStore: {} as ReadonlyStore,
  });

  const response = await server.hono.request("/metrics");

  expect(response.status).toBe(200);

  await server.kill();
});

test("metrics error", async (context) => {
  const server = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: context.common,
    readonlyStore: {} as ReadonlyStore,
  });

  const metricsSpy = vi.spyOn(context.common.metrics, "getMetrics");
  metricsSpy.mockRejectedValueOnce(new Error());

  const response = await server.hono.request("/metrics");

  expect(response.status).toBe(500);

  await server.kill();
});

test("metrics PUT", async (context) => {
  const server = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: context.common,
    readonlyStore: {} as ReadonlyStore,
  });

  const response = await server.hono.request("/metrics", { method: "PUT" });

  expect(response.status).toBe(404);

  await server.kill();
});

test("graphql", async (context) => {
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

  const graphqlSchema = buildGraphqlSchema(schema);

  const server = await createServer({
    graphqlSchema: graphqlSchema,
    common: context.common,
    readonlyStore: readonlyStore,
  });
  server.setHealthy();

  const response = await server.hono.request("/graphql", {
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

  await server.kill();
});

test("graphql extra filter", async (context) => {
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

  const graphqlSchema = buildGraphqlSchema(schema);

  const server = await createServer({
    graphqlSchema: graphqlSchema,
    common: context.common,
    readonlyStore: readonlyStore,
  });
  server.setHealthy();

  const response = await server.hono.request("/graphql", {
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

  expect(response.status).toBe(400);

  await cleanup();

  await server.kill();
});

test("graphql depth limit error", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({ id: p.string() }),
  }));

  const { readonlyStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  const graphqlSchema = buildGraphqlSchema(schema);

  const server = await createServer({
    graphqlSchema: graphqlSchema,
    common: {
      ...context.common,
      options: { ...context.common.options, graphqlMaxOperationDepth: 5 },
    },
    readonlyStore: readonlyStore,
  });
  server.setHealthy();

  const response = await server.hono.request("/graphql", {
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

  expect(response.status).toBe(400);
  const body = (await response.json()) as any;

  expect(body.errors).toMatchObject([
    { message: "Syntax Error: Query depth limit of 5 exceeded, found 7." },
  ]);

  await cleanup();

  await server.kill();
});

test("graphql max aliases error", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({ id: p.string() }),
  }));

  const { readonlyStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  const graphqlSchema = buildGraphqlSchema(schema);

  const server = await createServer({
    graphqlSchema: graphqlSchema,
    common: {
      ...context.common,
      options: { ...context.common.options, graphqlMaxOperationAliases: 2 },
    },
    readonlyStore: readonlyStore,
  });
  server.setHealthy();

  const response = await server.hono.request("/graphql", {
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

  expect(response.status).toBe(400);
  const body = (await response.json()) as any;

  expect(body.errors).toMatchObject([
    { message: "Syntax Error: Aliases limit of 2 exceeded, found 3." },
  ]);

  await cleanup();

  await server.kill();
});

test("graphql interactive", async (context) => {
  const server = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: context.common,
    readonlyStore: {} as ReadonlyStore,
  });
  server.setHealthy();

  const response = await server.hono.request("/graphql");

  expect(response.status).toBe(200);

  await server.kill();
});

test("missing route", async (context) => {
  const server = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: context.common,
    readonlyStore: {} as ReadonlyStore,
  });

  const response = await server.hono.request("/kevin");

  expect(response.status).toBe(404);

  await server.kill();
});

// Note that this test doesn't work because the `hono.request` method doesn't actually
// create a socket connection, it just calls the request handler function directly.
test.skip("kill", async (context) => {
  const server = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: context.common,
    readonlyStore: {} as ReadonlyStore,
  });

  await server.kill();

  expect(() => server.hono.request("/health")).rejects.toThrow();
});
