import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { context } from "@/_test/setup.js";
import { IS_BUN_TEST, stubGlobal } from "@/_test/utils.js";
import { createTelemetry } from "@/internal/telemetry.js";
import { rimrafSync } from "rimraf";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Common } from "./common.js";
import { createLogger } from "./logger.js";
import { createShutdown } from "./shutdown.js";

const fetchSpy = vi.fn();

let unstub: () => void;

beforeEach(() => {
  fetchSpy.mockReset();
  if (IS_BUN_TEST) {
    unstub = stubGlobal("fetch", fetchSpy);
  } else {
    vi.stubGlobal("fetch", fetchSpy);
  }
});

afterEach(() => {
  if (IS_BUN_TEST) unstub();
  else vi.unstubAllGlobals();
});

beforeEach(() => {
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

test("telemetry calls fetch with event body", async () => {
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

test("telemetry does not submit events if telemetry is disabled", async () => {
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

test("telemetry throws if event is submitted after kill", async () => {
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
