import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTelemetry } from "@/internal/telemetry.js";
import { rimrafSync } from "rimraf";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Common } from "./common.js";
import { createLogger } from "./logger.js";
import { createShutdown } from "./shutdown.js";

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach((context) => {
  const tempDir = path.join(os.tmpdir(), randomUUID());
  mkdirSync(tempDir, { recursive: true });

  context.common = {
    logger: createLogger({ level: "silent" }),
    options: {
      telemetryUrl: "https://ponder.sh/api/telemetry",
      telemetryDisabled: false,
      telemetryConfigDir: tempDir,
    },
  } as unknown as Common;

  return () => {
    rimrafSync(tempDir);
  };
});

test("telemetry calls fetch with event body", async (context) => {
  const shutdown = createShutdown();
  const telemetry = createTelemetry({
    options: context.common.options,
    logger: context.common.logger,
    shutdown,
  });

  telemetry.record({
    name: "lifecycle:heartbeat_send",
    properties: { duration_seconds: process.uptime() },
  });

  await telemetry.flush();
  await shutdown.kill();

  expect(fetchSpy).toHaveBeenCalledTimes(1);

  const fetchUrl = fetchSpy.mock.calls[0][0];
  expect(fetchUrl).toBe(context.common.options.telemetryUrl);

  const fetchBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
  expect(fetchBody).toMatchObject({
    distinctId: expect.any(String),
    event: "lifecycle:heartbeat_send",
    properties: { duration_seconds: expect.any(Number) },
  });
});

test("telemetry does not submit events if telemetry is disabled", async (context) => {
  const shutdown = createShutdown();
  const telemetry = createTelemetry({
    options: { ...context.common.options, telemetryDisabled: true },
    logger: context.common.logger,
    shutdown,
  });

  telemetry.record({
    name: "lifecycle:session_start",
    properties: { cli_command: "test" },
  });
  telemetry.record({
    name: "lifecycle:heartbeat_send",
    properties: { duration_seconds: process.uptime() },
  });

  await telemetry.flush();
  await shutdown.kill();

  expect(fetchSpy).not.toHaveBeenCalled();
});

test("telemetry throws if event is submitted after kill", async (context) => {
  const shutdown = createShutdown();
  const telemetry = createTelemetry({
    options: context.common.options,
    logger: context.common.logger,
    shutdown,
  });

  for (let i = 0; i < 5; i++) {
    telemetry.record({
      name: "lifecycle:heartbeat_send",
      properties: { duration_seconds: process.uptime() },
    });
  }

  await telemetry.flush();
  await shutdown.kill();

  expect(fetchSpy).toHaveBeenCalledTimes(5);

  telemetry.record({
    name: "lifecycle:heartbeat_send",
    properties: { duration_seconds: process.uptime() },
  });

  await telemetry.flush();

  expect(fetchSpy).toHaveBeenCalledTimes(5);
});

test("kill resolves within 1 second even with slow events", async (context) => {
  const shutdown = createShutdown();
  const telemetry = createTelemetry({
    options: context.common.options,
    logger: context.common.logger,
    shutdown,
  });

  // Mock fetch to simulate a slow request
  fetchSpy.mockImplementation(
    () => new Promise((resolve) => setTimeout(resolve, 5000)),
  );

  // Record an event that will trigger the slow fetch
  telemetry.record({
    name: "lifecycle:heartbeat_send",
    properties: { duration_seconds: process.uptime() },
  });

  const startTime = Date.now();
  await shutdown.kill();
  const endTime = Date.now();

  const killDuration = endTime - startTime;
  expect(killDuration).toBeLessThan(1100); // Allow a small buffer for execution time

  // Ensure that fetch was called, but not completed
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
