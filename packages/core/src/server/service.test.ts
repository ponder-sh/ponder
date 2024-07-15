import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getMetadataStore } from "@/indexing-store/metadata.js";
import type { Schema } from "@/schema/common.js";
import { beforeEach, expect, test, vi } from "vitest";
import { createServer } from "./service.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

test("port", async (context) => {
  const { database, namespaceInfo, cleanup } =
    await setupDatabaseServices(context);

  const server1 = await createServer({
    common: context.common,
    schema: {},
    database,
    dbNamespace: namespaceInfo.userNamespace,
  });

  const server2 = await createServer({
    common: context.common,
    schema: {},
    database,
    dbNamespace: namespaceInfo.userNamespace,
  });

  expect(server2.port).toBeGreaterThanOrEqual(server1.port + 1);

  await server1.kill();
  await server2.kill();
  await cleanup();
});

test("not healthy", async (context) => {
  const { database, namespaceInfo, cleanup } =
    await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    schema: {},
    database,
    dbNamespace: namespaceInfo.userNamespace,
  });

  const response = await server.hono.request("/_ponder/health");

  expect(response.status).toBe(503);

  await server.kill();
  await cleanup();
});

test("healthy", async (context) => {
  const { database, namespaceInfo, cleanup } =
    await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    schema: {},
    database,
    dbNamespace: namespaceInfo.userNamespace,
  });

  await getMetadataStore({
    encoding: database.kind,
    namespaceInfo,
    db: database.indexingDb,
  }).setStatus({});

  const response = await server.hono.request("/_ponder/health");

  expect(response.status).toBe(200);

  await server.kill();
  await cleanup();
});

test("healthy PUT", async (context) => {
  const { database, namespaceInfo, cleanup } =
    await setupDatabaseServices(context);

  const server = await createServer({
    common: {
      ...context.common,
      options: { ...context.common.options, maxHealthcheckDuration: 0 },
    },
    schema: {} as Schema,
    database,
    dbNamespace: namespaceInfo.userNamespace,
  });

  const response = await server.hono.request("/_ponder/health", {
    method: "PUT",
  });

  expect(response.status).toBe(404);

  await server.kill();
  await cleanup();
});

test("metrics", async (context) => {
  const { database, namespaceInfo, cleanup } =
    await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    schema: {},
    database,
    dbNamespace: namespaceInfo.userNamespace,
  });

  const response = await server.hono.request("/_ponder/metrics");

  expect(response.status).toBe(200);

  await server.kill();
  await cleanup();
});

test("metrics error", async (context) => {
  const { database, namespaceInfo, cleanup } =
    await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    schema: {},
    database,
    dbNamespace: namespaceInfo.userNamespace,
  });

  const metricsSpy = vi.spyOn(context.common.metrics, "getMetrics");
  metricsSpy.mockRejectedValueOnce(new Error());

  const response = await server.hono.request("/_ponder/metrics");

  expect(response.status).toBe(500);

  await server.kill();
  await cleanup();
});

test("metrics PUT", async (context) => {
  const { database, namespaceInfo, cleanup } =
    await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    schema: {},
    database,
    dbNamespace: namespaceInfo.userNamespace,
  });

  const response = await server.hono.request("/_ponder/metrics", {
    method: "PUT",
  });

  expect(response.status).toBe(404);

  await server.kill();
  await cleanup();
});

test("missing route", async (context) => {
  const { database, namespaceInfo, cleanup } =
    await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    schema: {},
    database,
    dbNamespace: namespaceInfo.userNamespace,
  });

  const response = await server.hono.request("/kevin");

  expect(response.status).toBe(404);

  await server.kill();
  await cleanup();
});

// Note that this test doesn't work because the `hono.request` method doesn't actually
// create a socket connection, it just calls the request handler function directly.
test.skip("kill", async (context) => {
  const { database, namespaceInfo } = await setupDatabaseServices(context);

  const server = await createServer({
    common: context.common,
    schema: {},
    database,
    dbNamespace: namespaceInfo.userNamespace,
  });

  await server.kill();

  expect(() => server.hono.request("/_ponder/health")).rejects.toThrow();
});
