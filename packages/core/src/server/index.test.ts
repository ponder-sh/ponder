import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import type { Context } from "@/hono/context.js";
import { getMetadataStore } from "@/indexing-store/metadata.js";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";
import { createServer } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

test("port", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const server1 = await createServer({
    common: context.common,
    app: new Hono(),
    routes: [],
    schema: {},
    database,
  });

  const server2 = await createServer({
    common: context.common,
    app: new Hono(),
    routes: [],
    schema: {},
    database,
  });

  expect(server2.port).toBeGreaterThanOrEqual(server1.port + 1);

  await server1.kill();
  await server2.kill();
  await cleanup();
});

test("listens on ipv4", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    app: new Hono(),
    routes: [],
    schema: {},
    database,
  });

  const response = await fetch(`http://localhost:${server.port}/health`);
  expect(response.status).toBe(200);

  await server.kill();
  await cleanup();
});

test("listens on ipv6", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    app: new Hono(),
    routes: [],
    schema: {},
    database,
  });

  const response = await fetch(`http://[::1]:${server.port}/health`);
  expect(response.status).toBe(200);

  await server.kill();
  await cleanup();
});

test("not ready", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    app: new Hono(),
    routes: [],
    schema: {},
    database,
  });

  const response = await server.hono.request("/ready");

  expect(response.status).toBe(503);

  await server.kill();
  await cleanup();
});

test("ready", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    app: new Hono(),
    routes: [],
    schema: {},
    database,
  });

  await getMetadataStore({
    dialect: database.dialect,
    db: database.qb.user,
  }).setStatus({});

  const response = await server.hono.request("/ready");

  expect(response.status).toBe(200);

  await server.kill();
  await cleanup();
});

test("health", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    app: new Hono(),
    routes: [],
    schema: {},
    database,
  });

  const response = await server.hono.request("/health");

  expect(response.status).toBe(200);

  await server.kill();
  await cleanup();
});

test("healthy PUT", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    app: new Hono(),
    routes: [],
    schema: {},
    database,
  });

  const response = await server.hono.request("/health", {
    method: "PUT",
  });

  expect(response.status).toBe(404);

  await server.kill();
  await cleanup();
});

test("metrics", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    app: new Hono(),
    routes: [],
    schema: {},
    database,
  });

  const response = await server.hono.request("/metrics");

  expect(response.status).toBe(200);

  await server.kill();
  await cleanup();
});

test("metrics error", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    app: new Hono(),
    routes: [],
    schema: {},
    database,
  });

  const metricsSpy = vi.spyOn(context.common.metrics, "getMetrics");
  metricsSpy.mockRejectedValueOnce(new Error());

  const response = await server.hono.request("/metrics");

  expect(response.status).toBe(500);

  await server.kill();
  await cleanup();
});

test("metrics PUT", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    app: new Hono(),
    routes: [],
    schema: {},
    database,
  });

  const response = await server.hono.request("/metrics", {
    method: "PUT",
  });

  expect(response.status).toBe(404);

  await server.kill();
  await cleanup();
});

test("metrics unmatched route", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    app: new Hono(),
    routes: [],
    schema: {},
    database,
  });

  await server.hono.request("/graphql");
  await server.hono.request("/unmatched");

  const response = await server.hono.request("/metrics");

  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).toContain('path="/graphql"');
  expect(text).not.toContain('path="/unmatched"');

  await server.kill();
  await cleanup();
});

test("missing route", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    app: new Hono(),
    routes: [],
    schema: {},
    database,
  });

  const response = await server.hono.request("/kevin");

  expect(response.status).toBe(404);

  await server.kill();
  await cleanup();
});

test("custom api route", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    app: new Hono(),
    routes: [
      { method: "GET", pathOrHandlers: ["/hi", (c: Context) => c.text("hi")] },
    ],
    schema: {},
    database,
  });

  const response = await server.hono.request("/hi");

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("hi");

  await server.kill();
  await cleanup();
});

test("custom hono route", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const app = new Hono().get("/hi", (c) => c.text("hi"));

  const server = await createServer({
    common: context.common,
    app,
    routes: [],
    schema: {},
    database,
  });

  const response = await server.hono.request("/hi");

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("hi");

  await server.kill();
  await cleanup();
});

// Note that this test doesn't work because the `hono.request` method doesn't actually
// create a socket connection, it just calls the request handler function directly.
test.skip("kill", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    app: new Hono(),
    routes: [],
    schema: {},
    database,
  });

  await server.kill();

  expect(() => server.hono.request("/health")).rejects.toThrow();
});
