import os from "node:os";
import readline from "node:readline";
import type { Common } from "@/common/common.js";
import { IgnorableError } from "@/common/errors.js";

const SHUTDOWN_GRACE_PERIOD_MS = 5_000;

/**
 * Sets up shutdown handlers for the process. Accepts additional cleanup logic to run.
 */
export function setupShutdown({
  common,
  cleanup,
}: {
  common: Common;
  cleanup: () => Promise<void>;
}) {
  let isShuttingDown = false;

  const shutdown = async ({
    reason,
    code,
  }: { reason: string; code: 0 | 1 }) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    setTimeout(async () => {
      common.logger.fatal({
        service: "process",
        msg: "Failed to shutdown within 5 seconds, terminating (exit code 1)",
      });
      await common.logger.kill();
      process.exit(1);
    }, SHUTDOWN_GRACE_PERIOD_MS);

    if (reason !== undefined) {
      common.logger.warn({
        service: "process",
        msg: `${reason}, starting shutdown sequence`,
      });
    }
    common.telemetry.record({
      name: "lifecycle:session_end",
      properties: { duration_seconds: process.uptime() },
    });

    await cleanup();

    const level = code === 0 ? "info" : "fatal";
    common.logger[level]({
      service: "process",
      msg: `Finished shutdown sequence, terminating (exit code ${code})`,
    });

    await common.logger.kill();
    process.exit(code);
  };

  if (os.platform() === "win32") {
    const readlineInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    readlineInterface.on("SIGINT", () =>
      shutdown({ reason: "Received SIGINT", code: 0 }),
    );
  }

  process.on("SIGINT", () => shutdown({ reason: "Received SIGINT", code: 0 }));
  process.on("SIGTERM", () =>
    shutdown({ reason: "Received SIGTERM", code: 0 }),
  );
  process.on("SIGQUIT", () =>
    shutdown({ reason: "Received SIGQUIT", code: 0 }),
  );

  process.on("uncaughtException", (error: Error) => {
    if (error instanceof IgnorableError) return;
    common.logger.error({
      service: "process",
      msg: "Caught uncaughtException event",
      error,
    });
    shutdown({ reason: "Received uncaughtException", code: 1 });
  });
  process.on("unhandledRejection", (error: Error) => {
    if (error instanceof IgnorableError) return;
    common.logger.error({
      service: "process",
      msg: "Caught unhandledRejection event",
      error,
    });
    shutdown({ reason: "Received unhandledRejection", code: 1 });
  });

  return shutdown;
}
