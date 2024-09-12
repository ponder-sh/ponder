import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTelemetry } from "@/common/telemetry.js";
import { wait } from "@/utils/wait.js";
import { rimrafSync } from "rimraf";
import { beforeEach, expect, test, vi } from "vitest";
import type { Common } from "./common.js";
import { createLogger } from "./logger.js";

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  return () => vi.unstubAllGlobals();
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
  const telemetry = createTelemetry({
    options: context.common.options,
    logger: context.common.logger,
  });

  telemetry.record({
    name: "lifecycle:heartbeat_send",
    properties: { duration_seconds: process.uptime() },
  });

  await wait(0);
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

  await wait(0);
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

  await wait(0);
  await telemetry.kill();

  expect(fetchSpy).toHaveBeenCalledTimes(5);

  telemetry.record({
    name: "lifecycle:heartbeat_send",
    properties: { duration_seconds: process.uptime() },
  });

  await wait(100);

  expect(fetchSpy).toHaveBeenCalledTimes(5);
});
