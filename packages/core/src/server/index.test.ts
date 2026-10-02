import http from "node:http";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";
import {
  context,
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getPonderMetaTable } from "@/database/index.js";
import { createServer } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("listens on ipv4", async () => {
  const { database } = await setupDatabaseServices();

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

test("listens on ipv6", async () => {
  const { database } = await setupDatabaseServices();

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

test("not ready", async () => {
  const { database } = await setupDatabaseServices();

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

test("ready", async () => {
  const { database } = await setupDatabaseServices();

  const server = await createServer({
    common: context.common,
    apiBuild: {
      app: new Hono(),

      port: context.common.options.port,
    },
    database,
  });

  await database.adminQB.wrap((db) =>
    db.update(getPonderMetaTable()).set({
      value: sql`jsonb_set(value, '{is_ready}', to_jsonb(1))`,
    }),
  );

  const response = await server.hono.request("/ready");

  expect(response.status).toBe(200);
});

test("health", async () => {
  const { database } = await setupDatabaseServices();

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

test("healthy PUT", async () => {
  const { database } = await setupDatabaseServices();

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

test("metrics", async () => {
  const { database } = await setupDatabaseServices();

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

test("metrics error", async () => {
  const { database } = await setupDatabaseServices();

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

test("metrics PUT", async () => {
  const { database } = await setupDatabaseServices();

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

test("metrics unmatched route", async () => {
  const { database } = await setupDatabaseServices();

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

test("missing route", async () => {
  const { database } = await setupDatabaseServices();

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

test("custom api route", async () => {
  const { database } = await setupDatabaseServices();

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

test("custom hono route", async () => {
  const { database } = await setupDatabaseServices();

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

test("kill closes idle keep-alive connections", async () => {
  const { database } = await setupDatabaseServices();

  await createServer({
    common: context.common,
    apiBuild: { app: new Hono(), port: context.common.options.port },
    database,
  });

  const agent = new http.Agent({ keepAlive: true });
  const response = await new Promise<http.IncomingMessage>(
    (resolve, reject) => {
      http
        .get(
          { agent, port: context.common.options.port, path: "/health" },
          (res) => res.resume().on("end", () => resolve(res)),
        )
        .on("error", reject);
    },
  );
  expect(response.statusCode).toBe(200);
  expect(response.headers.connection).toBe("keep-alive");

  const start = Date.now();
  await context.common.apiShutdown.kill();
  expect(Date.now() - start).toBeLessThan(500);

  await expect(
    fetch(`http://localhost:${context.common.options.port}/health`),
  ).rejects.toThrow();

  // The port can be bound again, which dev mode needs after a hot reload.
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(context.common.options.port, resolve);
  });
  await new Promise((resolve) => server.close(resolve));

  agent.destroy();
});
