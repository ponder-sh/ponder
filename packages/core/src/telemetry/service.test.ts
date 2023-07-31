import Conf from "conf";
import child_process from "node:child_process";
import * as fs from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import createFetchMock from "vitest-fetch-mock";

import { buildOptions } from "@/config/options.js";
import { TelemetryService } from "@/telemetry/service.js";

const fetchMocker = createFetchMock(vi);
const conf = new Conf({ projectName: "ponder" });

beforeAll(() => {
  fetchMocker.enableMocks();
});

beforeEach(() => {
  conf.clear();
  fetchMocker.resetMocks();
});

afterAll(() => {
  conf.clear();
  fetchMocker.disableMocks();
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
  const args = fetchMocker.mock.calls[0][1];

  if (!args || !args.body) {
    throw new Error("No payload sent to telemetry API");
  }

  const body = JSON.parse(args.body.toString());

  expect(body["payload"]).toEqual({});
  expect(body["eventName"]).toEqual("test");
  expect(body).toHaveProperty("meta");
  expect(body).toHaveProperty("sessionId");
  expect(body).toHaveProperty("anonymousId");
  expect(body).toHaveProperty("projectId");
});

test("events are not processed if telemetry is disabled", async ({
  common: { options },
}) => {
  const telemetry = new TelemetryService({ options });
  telemetry.setEnabled(false);
  await telemetry.record({ eventName: "test", payload: {} });
  expect(fetchMocker).not.toHaveBeenCalled();
});

test("events are put back in queue if telemetry service is killed", async ({
  common: { options },
}) => {
  const telemetry = new TelemetryService({ options });

  fetchMocker.mockImplementationOnce(() => {
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
  fetchMocker.mockImplementation(() => {
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
  expect(fetchMocker).toHaveBeenCalledTimes(10);

  fs.unlinkSync(persistedEventsPath);
});
