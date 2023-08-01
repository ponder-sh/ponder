import Conf from "conf";
import child_process from "node:child_process";
import fs from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";

import { buildOptions } from "@/config/options";
import { TelemetryService } from "@/telemetry/service";

const conf = new Conf({ projectName: "ponder" });

const fetchSpy = vi.fn().mockImplementation(() => vi.fn());

beforeEach(() => {
  conf.clear();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);

  return () => {
    vi.unstubAllGlobals();
  };
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
  await telemetry.record({ eventName: "test", payload: {} });
  const fetchBody = JSON.parse(fetchSpy.mock.calls[0][1]["body"]);
  expect(fetchSpy).toHaveBeenCalled();
  expect(fetchBody).toMatchObject({
    eventName: "test",
    payload: {},
    meta: expect.anything(),
    sessionId: expect.anything(),
    anonymousId: expect.anything(),
    projectId: expect.anything(),
  });
});

test("events are not processed if telemetry is disabled", async ({
  common: { options },
}) => {
  const telemetry = new TelemetryService({ options });
  telemetry.setEnabled(false);
  await telemetry.record({ eventName: "test", payload: {} });

  expect(fetchSpy).not.toHaveBeenCalled();
});

test("events are put back in queue if telemetry service is killed", async ({
  common: { options },
}) => {
  const telemetry = new TelemetryService({ options });

  fetchSpy.mockImplementationOnce(() => {
    throw { name: "AbortError" };
  });

  await telemetry.record({ eventName: "test", payload: {} });

  expect(telemetry.eventsCount).toBe(1);
});

test("kill method should persis events queue and trigger detached flush", async ({
  common: { options },
}) => {
  const spawn = vi.spyOn(child_process, "spawn");
  const persistedEventsPath = options.ponderDir + "/telemetry-events.json";
  const telemetry = new TelemetryService({ options });

  // we need to mock the fetch call to throw an AbortError so that the event is
  // put back in the queue
  fetchSpy.mockImplementation(() => {
    throw { name: "AbortError" };
  });

  for (let i = 0; i < 10; i++) {
    await telemetry.record({ eventName: "test", payload: {} });
  }

  await telemetry.kill();

  expect(fs.existsSync(persistedEventsPath)).toBe(true);

  const events = JSON.parse(
    fs.readFileSync(options.ponderDir + "/telemetry-events.json").toString()
  );

  expect(events.length).toBe(10);
  expect(spawn).toHaveBeenCalled();
  expect(fetchSpy).toHaveBeenCalledTimes(10);

  fs.unlinkSync(persistedEventsPath);
});
