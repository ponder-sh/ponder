import {
  setupCleanup,
  setupCommon,
  setupDatabase,
  setupPonder,
} from "@/_test/setup.js";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";
import { createServer } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupDatabase);
beforeEach(setupCleanup);

test("listens on ipv4", async (context) => {
  const app = await setupPonder(context);

  await createServer(app);

  const response = await fetch(
    `http://localhost:${context.common.options.port}/health`,
  );
  expect(response.status).toBe(200);
});

test("listens on ipv6", async (context) => {
  const app = await setupPonder(context);

  await createServer(app);

  const response = await fetch(
    `http://[::1]:${context.common.options.port}/health`,
  );
  expect(response.status).toBe(200);
});

test("not ready", async (context) => {
  const app = await setupPonder(context);

  const server = await createServer(app);

  const response = await server.hono.request("/ready");

  expect(response.status).toBe(503);
});

test("ready", async (context) => {
  const app = await setupPonder(context);

  const server = await createServer(app);

  await app.database.setReady();

  const response = await server.hono.request("/ready");

  expect(response.status).toBe(200);
});

test("health", async (context) => {
  const app = await setupPonder(context);

  const server = await createServer(app);

  const response = await server.hono.request("/health");

  expect(response.status).toBe(200);
});

test("healthy PUT", async (context) => {
  const app = await setupPonder(context);

  const server = await createServer(app);

  const response = await server.hono.request("/health", {
    method: "PUT",
  });

  expect(response.status).toBe(404);
});

test("metrics", async (context) => {
  const app = await setupPonder(context);

  const server = await createServer(app);

  const response = await server.hono.request("/metrics");

  expect(response.status).toBe(200);
});

test("metrics error", async (context) => {
  const app = await setupPonder(context);

  const server = await createServer(app);

  const metricsSpy = vi.spyOn(context.common.metrics, "getMetrics");
  metricsSpy.mockRejectedValueOnce(new Error());

  const response = await server.hono.request("/metrics");

  expect(response.status).toBe(500);
});

test("metrics PUT", async (context) => {
  const app = await setupPonder(context);

  const server = await createServer(app);

  const response = await server.hono.request("/metrics", {
    method: "PUT",
  });

  expect(response.status).toBe(404);
});

test("metrics unmatched route", async (context) => {
  const app = await setupPonder(context);

  const server = await createServer(app);

  await server.hono.request("/unmatched");

  const response = await server.hono.request("/metrics");

  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain('path="/unmatched"');
});

test("missing route", async (context) => {
  const app = await setupPonder(context);

  const server = await createServer(app);

  const response = await server.hono.request("/kevin");

  expect(response.status).toBe(404);
});

test("custom api route", async (context) => {
  const app = await setupPonder(context, {
    app: new Hono().get("/hi", (c) => c.text("hi")),
  });

  const server = await createServer(app);

  const response = await server.hono.request("/hi");

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("hi");
});

// Note that this test doesn't work because the `hono.request` method doesn't actually
// create a socket connection, it just calls the request handler function directly.
test.skip("kill", async (context) => {
  const app = await setupPonder(context);

  const server = await createServer(app);

  expect(() => server.hono.request("/health")).rejects.toThrow();
});
