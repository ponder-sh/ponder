import child_process from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { expect, test } from "vitest";

test("detached flush script should run without error", async () => {
  // This is a service that always responds to POST requests with a 200 OK.
  const telemetryUrl = "https://reqres.in/api/users";

  const events = Array.from({ length: 5 }, () => ({
    event: "test",
    payload: {},
  }));

  const telemetryEventsFilePath = path.join(tmpdir(), "events.json");
  writeFileSync(telemetryEventsFilePath, JSON.stringify(events));

  const flushDetachedScriptPath = path.join(__dirname, "detached-flush.js");

  const { error, stdout, stderr } = await new Promise<{
    error: Error | null;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    child_process.exec(
      `"${process.execPath}" "${flushDetachedScriptPath}" "${telemetryUrl}" "${telemetryEventsFilePath}"`,
      (error, stdout, stderr) => resolve({ error, stdout, stderr }),
    );
  });

  expect(stderr).toBe("");
  expect(error).toBe(null);
  expect(stdout).toBe("");
  expect(existsSync(telemetryEventsFilePath)).toBeFalsy();
});
