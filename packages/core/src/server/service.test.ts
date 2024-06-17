import { setupCommon, setupIsolatedDatabase } from "@/_test/setup.js";
import type { ReadonlyStore } from "@/indexing-store/store.js";
import type { Schema } from "@/schema/common.js";
import { beforeEach, expect, test, vi } from "vitest";
import { createServer } from "./service.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

test("port", async (context) => {
  const server1 = await createServer({
    schema: {} as Schema,
    common: context.common,
    readonlyStore: {} as ReadonlyStore,
  });

  const server2 = await createServer({
    schema: {} as Schema,
    common: context.common,
    readonlyStore: {} as ReadonlyStore,
  });

  expect(server2.port).toBeGreaterThanOrEqual(server1.port + 1);

  await server1.kill();
  await server2.kill();
});

test("not healthy", async (context) => {
  const server = await createServer({
    schema: {} as Schema,
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
    schema: {} as Schema,
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
    schema: {} as Schema,
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
    schema: {} as Schema,
    common: context.common,
    readonlyStore: {} as ReadonlyStore,
  });

  const response = await server.hono.request("/metrics");

  expect(response.status).toBe(200);

  await server.kill();
});

test("metrics error", async (context) => {
  const server = await createServer({
    schema: {} as Schema,
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
    schema: {} as Schema,
    common: context.common,
    readonlyStore: {} as ReadonlyStore,
  });

  const response = await server.hono.request("/metrics", { method: "PUT" });

  expect(response.status).toBe(404);

  await server.kill();
});

test("missing route", async (context) => {
  const server = await createServer({
    schema: {} as Schema,
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
    schema: {} as Schema,
    common: context.common,
    readonlyStore: {} as ReadonlyStore,
  });

  await server.kill();

  expect(() => server.hono.request("/health")).rejects.toThrow();
});
