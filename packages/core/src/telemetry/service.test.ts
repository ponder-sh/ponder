import child_process from "node:child_process";
import fs from "node:fs";
import path from "path";
import process from "process";
import { afterAll, beforeEach, expect, test, vi } from "vitest";

import { buildOptions } from "@/config/options";
import { TelemetryService } from "@/telemetry/service";

// Prevents the detached-flush script from sending events to API during tests.
vi.mock("node-fetch");

const fetchSpy = vi.fn().mockImplementation(() => vi.fn());

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  return () => vi.unstubAllGlobals();
});

afterAll(() => {
  vi.restoreAllMocks();
});

test("should be disabled if PONDER_TELEMETRY_DISABLED flag is set", async () => {
  process.env.PONDER_TELEMETRY_DISABLED = "true";

  // we're not using the options from the context because we want to test that
  // build options will correctly set the telemetry service as disabled if the
  // env var is set
  const options = buildOptions({ cliOptions: { configFile: "", rootDir: "" } });
  const telemetry = new TelemetryService({ options });

  expect(telemetry.disabled).toBe(true);

  delete process.env.PONDER_TELEMETRY_DISABLED;
});

test("events are processed", async ({ common: { options } }) => {
  const telemetry = new TelemetryService({ options });

  telemetry.record({ event: "test" });
  await telemetry.flush();

  expect(fetchSpy).toHaveBeenCalled();

  const fetchBody = JSON.parse(fetchSpy.mock.calls[0][1]["body"]);
  expect(fetchBody).toMatchObject({
    event: "test",
    meta: expect.anything(),
    sessionId: expect.anything(),
    anonymousId: expect.anything(),
    projectId: expect.anything(),
  });
});

test("events are not processed if telemetry is disabled", async ({
  common: { options },
}) => {
  const telemetry = new TelemetryService({
    options: { ...options, telemetryDisabled: true },
  });

  telemetry.record({ event: "test" });
  await telemetry.flush();

  expect(fetchSpy).not.toHaveBeenCalled();
});

test("events are put back in queue if telemetry service is killed", async ({
  common: { options },
}) => {
  const telemetry = new TelemetryService({ options });

  fetchSpy.mockImplementationOnce(() => {
    throw { name: "AbortError" };
  });

  telemetry.record({ event: "test" });
  await telemetry.flush();

  expect(telemetry["events"].length).toBe(1);
});

test("kill method should persist events and trigger detached flush", async ({
  common: { options },
}) => {
  const spawn = vi.spyOn(child_process, "spawn");
  const telemetry = new TelemetryService({ options });
  const fileName = path.join(options.ponderDir, "telemetry-events.json");

  const writeFileSyncSpy = vi
    .spyOn(fs, "writeFileSync")
    .mockImplementationOnce(() => vi.fn());

  // we need to mock the fetch call to throw an AbortError so that the event is
  // put back in the queue
  fetchSpy.mockImplementation(() => {
    throw { name: "AbortError" };
  });

  for (let i = 0; i < 10; i++) {
    telemetry.record({ event: "test" });
  }
  // Note that we are not flushing here, because we want to test the detachedFlush flow.
  await telemetry.flush();

  await telemetry.kill();
  const fileNameArgument = writeFileSyncSpy.mock.calls[0][0];

  expect(spawn).toHaveBeenCalled();
  expect(fileNameArgument).toBe(fileName);
  expect(fetchSpy).toHaveBeenCalledTimes(10);
});
