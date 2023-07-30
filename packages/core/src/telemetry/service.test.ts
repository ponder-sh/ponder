import * as fs from "fs";
import os from "os";
import * as process from "process";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import createFetchMock from "vitest-fetch-mock";

import { buildOptions } from "@/config/options";
import { TelemetryService } from "@/telemetry/service";

const cpus = os.cpus() || [];

const spawn = vi.fn();

vi.mock("child_process", () => ({
  spawn: spawn,
}));

const options = buildOptions({
  cliOptions: { configFile: "", rootDir: "" },
});

const metadata = {
  systemPlatform: os.platform(),
  systemRelease: os.release(),
  systemArchitecture: os.arch(),
  cpuCount: cpus.length,
  cpuModel: cpus.length ? cpus[0].model : null,
  cpuSpeed: cpus.length ? cpus[0].speed : null,
  memoryInMb: Math.trunc(os.totalmem() / Math.pow(1024, 2)),
};

const fetchMocker = createFetchMock(vi);

beforeAll(() => {
  fetchMocker.enableMocks();
});

afterEach(() => {
  fs.unlinkSync(options.ponderDir + "/telemetry-config.json");
});

afterAll(() => {
  fetchMocker.disableMocks();
});

test("should be disabled if PONDER_TELEMETRY_DISABLED flag is set", async () => {
  process.env.PONDER_TELEMETRY_DISABLED = "true";
  const telemetry = new TelemetryService({ options });
  expect(telemetry.disabled).toBe(true);
  delete process.env.PONDER_TELEMETRY_DISABLED;
});

test("should be enabled PONDER_TELEMETRY_DISABLED flag is not set", async () => {
  const telemetry = new TelemetryService({ options });
  expect(telemetry.disabled).toBe(false);
});

test("should create telemetry config file if it does not exist", async () => {
  new TelemetryService({ options });
  expect(fs.existsSync(options.ponderDir + "/telemetry-config.json")).toBe(
    true
  );
});

test("events are processed", async () => {
  const telemetry = new TelemetryService({ options });
  await telemetry.record({ eventName: "test", payload: {} });
  const args = fetchMocker.mock.calls[0][1];

  if (!args || !args.body) {
    throw new Error("No payload sent to telemetry API");
  }

  const body = JSON.parse(args.body.toString());

  expect(body["payload"]).toEqual({});
  expect(body["eventName"]).toEqual("test");
  expect(body["meta"]).toEqual(metadata);
  expect(body).toHaveProperty("sessionId");
  expect(body).toHaveProperty("anonymousId");
  expect(body).toHaveProperty("projectId");
});

test("events are not processed if telemetry is disabled", async () => {
  const telemetry = new TelemetryService({ options });
  telemetry.setEnabled(false);
  await telemetry.record({ eventName: "test", payload: {} });

  expect(fetchMocker).not.toHaveBeenCalled();
});

test("events are put back in queue if telemetry service is killed", async () => {
  const telemetry = new TelemetryService({ options });

  fetchMocker.mockImplementationOnce(() => {
    throw { name: "AbortError" };
  });

  await telemetry.record({ eventName: "test", payload: {} });

  expect(telemetry.eventsCount).toBe(1);
});

test("kill method should persis events queue and trigger detached flush", async () => {
  const persistedEventsPath = options.ponderDir + "/telemetry-events.json";
  const telemetry = new TelemetryService({ options });

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

  fetchMocker.resetMocks();
  fs.unlinkSync(persistedEventsPath);
});
