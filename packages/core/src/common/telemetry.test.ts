import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTelemetry } from "@/common/telemetry.js";
import { beforeEach, expect, test, vi } from "vitest";

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  return () => vi.unstubAllGlobals();
});

beforeEach((context) => {
  const tempDir = path.join(os.tmpdir(), randomUUID());
  mkdirSync(tempDir, { recursive: true });

  context.common.options = {
    ...context.common.options,
    telemetryDisabled: false,
    telemetryConfigDir: tempDir,
  };

  return async () => {
    rmSync(tempDir, { force: true, recursive: true });
  };
});

test("telemetry without existing conf creates new conf", async (context) => {
  const telemetry = createTelemetry({
    options: context.common.options,
    logger: context.common.logger,
  });

  telemetry.record({
    name: "lifecycle:heartbeat_send",
    properties: { duration_seconds: process.uptime() },
  });

  await telemetry.kill();

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
  const telemetry = createTelemetry({
    options: { ...context.common.options, telemetryDisabled: true },
    logger: context.common.logger,
  });

  telemetry.record({
    name: "lifecycle:session_start",
    properties: { cli_command: "test" },
  });
  telemetry.record({
    name: "lifecycle:heartbeat_send",
    properties: { duration_seconds: process.uptime() },
  });

  await telemetry.kill();

  expect(fetchSpy).toHaveBeenCalledTimes(0);
});

test("telemetry throws if event is submitted after kill", async (context) => {
  const telemetry = createTelemetry({
    options: context.common.options,
    logger: context.common.logger,
  });

  for (let i = 0; i < 5; i++) {
    telemetry.record({
      name: "lifecycle:heartbeat_send",
      properties: { duration_seconds: process.uptime() },
    });
  }

  await telemetry.kill();

  expect(fetchSpy).toHaveBeenCalledTimes(5);

  expect(() =>
    telemetry.record({
      name: "lifecycle:heartbeat_send",
      properties: { duration_seconds: process.uptime() },
    }),
  ).toThrow(
    "Invariant violation, attempted to record event after telemetry service was killed",
  );

  expect(fetchSpy).toHaveBeenCalledTimes(5);
});

test("telemetry kill clears enqueued events", async (context) => {
  const telemetry = createTelemetry({
    options: context.common.options,
    logger: context.common.logger,
  });

  // Mock fetch to take 500ms to complete.
  fetchSpy.mockImplementation(
    () => new Promise((resolve) => setTimeout(resolve, 500)),
  );

  for (let i = 0; i < 100; i++) {
    telemetry.record({
      name: "lifecycle:heartbeat_send",
      properties: { duration_seconds: process.uptime() },
    });
  }

  await telemetry.kill();

  // Only 10 of the 100 requests should have been completed
  // because the queue has a concurrency of 10.
  expect(fetchSpy).toHaveBeenCalledTimes(10);
});
