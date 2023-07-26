import { afterEach, beforeEach, expect, test } from "vitest";

import { buildOptions } from "@/config/options";
import { TelemetryService } from "@/telemetry/service";

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
});

afterEach(() => {
  process.env = originalEnv;
});

test("should be disabled if TELEMETRY_DISABLED flag is set", async () => {
  process.env.TELEMETRY_DISABLED = "true";
  const options = buildOptions({
    cliOptions: { configFile: "", rootDir: "" },
  });
  const telemetry = new TelemetryService({ options });
  expect(telemetry.disabled).toBe(true);
});
