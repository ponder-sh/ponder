import os from "node:os";
import readline from "node:readline";
import type { Common } from "@/internal/common.js";

const SHUTDOWN_GRACE_PERIOD_MS = 5_000;

/** Sets up shutdown handlers for the process. Accepts additional cleanup logic to run. */
export const createExit = ({
  common,
}: {
  common: Pick<Common, "logger" | "telemetry" | "shutdown">;
}) => {
  let isShuttingDown = false;

  const exit = async ({
    reason,
    code,
  }: { reason: string; code: 0 | 1 | 75 }) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    const timeout = setTimeout(async () => {
      common.logger.fatal({
        service: "process",
        msg: "Failed to shutdown within 5 seconds, terminating (exit code 1)",
      });
      process.exit(1);
    }, SHUTDOWN_GRACE_PERIOD_MS);

    if (reason !== undefined) {
      common.logger[code === 0 ? "info" : "warn"]({
        service: "process",
        msg: `${reason}, starting shutdown sequence`,
      });
    }
    common.telemetry.record({
      name: "lifecycle:session_end",
      properties: { duration_seconds: process.uptime() },
    });

    await common.shutdown.kill();
    clearTimeout(timeout);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }

    process.exit(code);
  };

  if (os.platform() === "win32") {
    const readlineInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    readlineInterface.on("SIGINT", () =>
      exit({ reason: "Received SIGINT", code: 0 }),
    );
  }

  process.on("SIGINT", () => exit({ reason: "Received SIGINT", code: 0 }));
  process.on("SIGTERM", () => exit({ reason: "Received SIGTERM", code: 0 }));
  process.on("SIGQUIT", () => exit({ reason: "Received SIGQUIT", code: 0 }));

  return exit;
};
