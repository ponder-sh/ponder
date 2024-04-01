import { setupDatabaseServices, setupIsolatedDatabase } from "@/_test/setup.js";
import { getTableIds } from "@/_test/utils.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import { createSchema } from "@/schema/schema.js";
import { zeroCheckpoint } from "@/utils/checkpoint.js";
import type { GraphQLSchema } from "graphql";
import { expect, test, vi } from "vitest";
import { buildGraphqlSchema } from "./graphql/buildGraphqlSchema.js";
import { createServer } from "./service.js";

test("port", async (context) => {
  const server1 = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: context.common,
    indexingStore: {} as IndexingStore,
  });

  const server2 = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: context.common,
    indexingStore: {} as IndexingStore,
  });

  expect(server1.port + 1).toBe(server2.port);
});

test("not healthy", async (context) => {
  const server = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: {
      ...context.common,
      options: { ...context.common.options, maxHealthcheckDuration: 5_000 },
    },
    indexingStore: {} as IndexingStore,
  });

  const response = await server.hono.request("/health");

  expect(response.status).toBe(503);
});

test("healthy", async (context) => {
  const server = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: {
      ...context.common,
      options: { ...context.common.options, maxHealthcheckDuration: 0 },
    },
    indexingStore: {} as IndexingStore,
  });

  const response = await server.hono.request("/health");

  expect(response.status).toBe(200);
});

test("metrics", async (context) => {
  const server = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: context.common,
    indexingStore: {} as IndexingStore,
  });

  const response = await server.hono.request("/metrics");

  expect(response.status).toBe(200);
});

test("metrics error", async (context) => {
  const server = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: context.common,
    indexingStore: {} as IndexingStore,
  });

  const metricsSpy = vi.spyOn(context.common.metrics, "getMetrics");
  metricsSpy.mockRejectedValueOnce(new Error());

  const response = await server.hono.request("/metrics");

  expect(response.status).toBe(500);
});

test("graphql", async (context) => {
  const shutdown = await setupIsolatedDatabase(context);
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

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "table",
    checkpoint: zeroCheckpoint,
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
    indexingStore: indexingStore,
  });

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

  await shutdown();
});

test("graphql interactive", async (context) => {
  const server = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: context.common,
    indexingStore: {} as IndexingStore,
  });

  const response = await server.hono.request("/graphql");

  expect(response.status).toBe(200);
});

// Note that this test doesn't work because the `hono.request` method doesn't actually
// create a socket connection, it just calls the request handler function directly.
test.fails("kill", async (context) => {
  const server = await createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: context.common,
    indexingStore: {} as IndexingStore,
  });

  await server.kill();

  expect(() => server.hono.request("/health")).rejects.toThrow();
});
