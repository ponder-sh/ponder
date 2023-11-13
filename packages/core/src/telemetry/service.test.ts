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

  const fetchBody = JSON.parse(fetchSpy.mock.calls[0][1]["body"]);
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

  expect(telemetry["events"].length).toBe(1);
});

test("kill method should persist events and trigger detached flush", async (context) => {
  const options = {
    ...context.common.options,
    telemetryDisabled: false,
    telemetryUrl: "https://reqres.in/api/users",
    ponderDir: tmpdir(),
  };

  const spawn = vi.spyOn(child_process, "spawn");
  const telemetry = new TelemetryService({ options });
  const fileName = path.join(options.ponderDir, "telemetry-events.json");

  const writeFileSyncSpy = vi
    .spyOn(fs, "writeFileSync")
    .mockImplementationOnce(() => vi.fn());

  // Mock the fetch call to throw an AbortError so that the event is put back in the queue.
  fetchSpy.mockImplementation(() => {
    throw { name: "AbortError" };
  });

  for (let i = 0; i < 10; i++) {
    telemetry.record({ event: "test" });
  }
  // Note that we are not flushing here, because we want to test the detachedFlush flow.

  await telemetry.kill();

  const fileNameArgument = writeFileSyncSpy.mock.calls[0][0];

  expect(spawn).toHaveBeenCalled();
  expect(fileNameArgument).toBe(fileName);
});
