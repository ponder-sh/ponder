import child_process from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { expect, test } from "vitest";

test("detached flush script should run without error", async ({ common }) => {
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
      `${process.execPath} ${flushDetachedScriptPath} ${common.options.telemetryUrl} ${telemetryEventsFilePath}`,
      (error, stdout, stderr) => resolve({ error, stdout, stderr })
    );
  });

  // if the script ran successfully, the temporary file should be deleted
  if (existsSync(telemetryEventsFilePath)) {
    rmSync(telemetryEventsFilePath);
  }

  expect(stderr).toBe("");
  expect(error).toBe(null);
  expect(stdout).toContain(
    `Sending 5 telemetry events to https://ponder.sh/api/telemetry from temporary file ${telemetryEventsFilePath}`
  );
});
