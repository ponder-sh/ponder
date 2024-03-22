import type { Common } from "@/Ponder.js";
import type { DatabaseService } from "@/database/service.js";
import { expect, test, vi } from "vitest";
import { createServer, killServer } from "./service2.js";

const database: DatabaseService = {} as DatabaseService;
const common: Common = {} as Common;

const server = createServer({ common: common!, database: database! });

test.only("health", async () => {
  const databaseSpy = vi.spyOn(database!, "isPublished");
  databaseSpy.mockReturnValue(true);

  const response = await server.hono.request("/health");

  expect(response.status).toBe(200);
});

test("", async () => {
  const response = await server.hono.request("/");

  expect(await response.text()).toBe("hi kyle");

  await killServer(server);
});

// test;

test.todo("health");

test("metrics error", async () => {
  try {
    const response = await server.hono.request("/metrics");

    expect(response.status).toBe(500);
  } catch (e) {
    console.log(e);
  }
});
