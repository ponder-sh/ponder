import {
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { beforeEach, expect, test, vi } from "vitest";
import { createServer } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("listens on ipv4", async (context) => {
  const { database } = await setupDatabaseServices(context);

  await createServer({
    common: context.common,
    apiBuild: {
      app: new Hono(),
      port: context.common.options.port,
    },
    database,
  });

  const response = await fetch(
    `http://localhost:${context.common.options.port}/health`,
  );
  expect(response.status).toBe(200);
});

test("listens on ipv6", async (context) => {
  const { database } = await setupDatabaseServices(context);

  await createServer({
    common: context.common,
    apiBuild: {
      app: new Hono(),
      port: context.common.options.port,
    },
    database,
  });

  const response = await fetch(
    `http://[::1]:${context.common.options.port}/health`,
  );
  expect(response.status).toBe(200);
});

test("not ready", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    apiBuild: {
      app: new Hono(),
      port: context.common.options.port,
    },
    database,
  });

  const response = await server.hono.request("/ready");

  expect(response.status).toBe(503);
});

test("ready", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    apiBuild: {
      app: new Hono(),
      port: context.common.options.port,
    },
    database,
  });

  await database.setStatus({
    1: {
      ready: true,
      block: {
        number: 1,
        timestamp: 1,
      },
    },
  });

  const response = await server.hono.request("/ready");

  expect(response.status).toBe(200);
});

test("health", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    apiBuild: {
      app: new Hono(),
      port: context.common.options.port,
    },
    database,
  });

  const response = await server.hono.request("/health");

  expect(response.status).toBe(200);
});

test("healthy PUT", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    apiBuild: {
      app: new Hono(),
      port: context.common.options.port,
    },
    database,
  });

  const response = await server.hono.request("/health", {
    method: "PUT",
  });

  expect(response.status).toBe(404);
});

test("metrics", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    apiBuild: {
      app: new Hono(),
      port: context.common.options.port,
    },
    database,
  });

  const response = await server.hono.request("/metrics");

  expect(response.status).toBe(200);
});

test("metrics error", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    apiBuild: {
      app: new Hono(),
      port: context.common.options.port,
    },
    database,
  });

  const metricsSpy = vi.spyOn(context.common.metrics, "getMetrics");
  metricsSpy.mockRejectedValueOnce(new Error());

  const response = await server.hono.request("/metrics");

  expect(response.status).toBe(500);
});

test("metrics PUT", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    apiBuild: {
      app: new Hono(),
      port: context.common.options.port,
    },
    database,
  });

  const response = await server.hono.request("/metrics", {
    method: "PUT",
  });

  expect(response.status).toBe(404);
});

test("metrics unmatched route", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    apiBuild: {
      app: new Hono(),
      port: context.common.options.port,
    },
    database,
  });

  await server.hono.request("/unmatched");

  const response = await server.hono.request("/metrics");

  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain('path="/unmatched"');
});

test("missing route", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    apiBuild: {
      app: new Hono(),
      port: context.common.options.port,
    },
    database,
  });

  const response = await server.hono.request("/kevin");

  expect(response.status).toBe(404);
});

test("custom api route", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    apiBuild: {
      app: new Hono().get("/hi", (c) => c.text("hi")),
      port: context.common.options.port,
    },
    database,
  });

  const response = await server.hono.request("/hi");

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("hi");
});

test("custom hono route", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const app = new Hono().get("/hi", (c) => c.text("hi"));

  const server = await createServer({
    common: context.common,
    apiBuild: { app, port: context.common.options.port },
    database,
  });

  const response = await server.hono.request("/hi");

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("hi");
});

test("custom cors response headers", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const app = new Hono()
    .get("/default", (c) => c.text("hi"))
    .get("/custom-middleware", cors({ origin: "custom-middleware" }), (c) =>
      c.text("hi"),
    )
    .get("/custom-inline", (c) => {
      c.header("access-control-allow-origin", "custom-inline");
      return c.text("hi");
    });

  const server = await createServer({
    common: context.common,
    apiBuild: { app, port: context.common.options.port },
    database,
  });

  const default_ = (await server.hono.request("/default")).headers.get(
    "access-control-allow-origin",
  );
  const customMiddleware = (
    await server.hono.request("/custom-middleware")
  ).headers.get("access-control-allow-origin");
  const customInline = (
    await server.hono.request("/custom-inline")
  ).headers.get("access-control-allow-origin");

  expect(default_).toBe("*");
  expect(customMiddleware).toBe("custom-middleware");
  expect(customInline).toBe("custom-inline");
});

// Note that this test doesn't work because the `hono.request` method doesn't actually
// create a socket connection, it just calls the request handler function directly.
test.skip("kill", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    apiBuild: {
      app: new Hono(),
      port: context.common.options.port,
    },
    database,
  });

  expect(() => server.hono.request("/health")).rejects.toThrow();
});
