import Conf from "conf";
import child_process from "node:child_process";
import fs from "node:fs";
import path from "path";
import process from "process";
import { afterAll, beforeEach, expect, test, vi } from "vitest";

import { buildOptions } from "@/config/options";
import { TelemetryService } from "@/telemetry/service";

// prevents the detached-flush script from sending events to API during tests
vi.mock("node-fetch");

const conf = new Conf({ projectName: "ponder" });

// this is to spy the fetch function in the telemetry service
const fetchSpy = vi.fn().mockImplementation(() => vi.fn());

beforeEach(() => {
  conf.clear();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);

  return () => {
    vi.unstubAllGlobals();
  };
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
  await telemetry.record({ event: "test", payload: {} });
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
  await telemetry.record({ event: "test", payload: {} });

  expect(fetchSpy).not.toHaveBeenCalled();
});

test("events are put back in queue if telemetry service is killed", async ({
  common: { options },
}) => {
  const telemetry = new TelemetryService({ options });

  fetchSpy.mockImplementationOnce(() => {
    throw { name: "AbortError" };
  });

  await telemetry.record({ event: "test", payload: {} });

  expect(telemetry.eventsCount).toBe(1);
});

test("kill method should persis events queue and trigger detached flush", async ({
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
    await telemetry.record({ event: "test", payload: {} });
  }

  await telemetry.kill();
  const fileNameArgument = writeFileSyncSpy.mock.calls[0][0];

  expect(spawn).toHaveBeenCalled();
  expect(fileNameArgument).toBe(fileName);
  expect(fetchSpy).toHaveBeenCalledTimes(10);
});

test("detached flush script should run without errors", async ({
  common: { options },
}) => {
  const fileName = path.join(
    options.rootDir,
    "tmp",
    "telemetry-events-test.json"
  );

  const events = Array.from({ length: 10 }, () => ({
    eventName: "test",
    payload: {},
  }));

  fs.writeFileSync(fileName, JSON.stringify(events));

  const flushDetachedScriptPath = path.join(__dirname, "detached-flush.js");

  await new Promise((resolve, reject) => {
    child_process.exec(
      `${process.execPath} ${flushDetachedScriptPath} ${fileName}`,
      (error) => {
        if (error) {
          return reject(error);
        }
        return resolve(null);
      }
    );
  }).finally(() => {
    fs.unlinkSync(fileName);
  });
});
