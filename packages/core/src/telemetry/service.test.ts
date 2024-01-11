import child_process from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";

import path from "path";
import { beforeEach, expect, test, vi } from "vitest";

import { TelemetryService } from "@/telemetry/service.js";

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  return () => vi.unstubAllGlobals();
});

test("events are processed", async (context) => {
  const options = { ...context.common.options, telemetryDisabled: false };
  const telemetry = new TelemetryService({ options });

  telemetry.record({ event: "test", properties: { test: "data" } });
  await telemetry.flush();

  expect(fetchSpy).toHaveBeenCalled();

  const fetchBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
  expect(fetchBody).toMatchObject({
    anonymousId: expect.any(String),
    context: expect.anything(),
    event: "test",
    properties: { test: "data" },
  });
});

test("events are not processed if telemetry is disabled", async (context) => {
  const options = { ...context.common.options, telemetryDisabled: true };
  const telemetry = new TelemetryService({ options });

  telemetry.record({ event: "test" });
  await telemetry.flush();

  expect(fetchSpy).not.toHaveBeenCalled();
});

test("events are put back in queue if telemetry service is killed", async (context) => {
  const options = {
    ...context.common.options,
    telemetryDisabled: false,
    telemetryUrl: "https://reqres.in/api/users",
  };
  const telemetry = new TelemetryService({ options });

  fetchSpy.mockImplementationOnce(() => {
    throw { name: "AbortError" };
  });

  telemetry.record({ event: "test" });
  await telemetry.flush();

  // @ts-ignore
  expect(telemetry.events.length).toBe(1);
});
