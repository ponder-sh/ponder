import type { Common } from "@/common/common.js";

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

  const shutdown = async (reason?: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    setTimeout(() => {
      common.logger.fatal({
        service: "process",
        msg: "Failed to shutdown within 5 seconds, terminating (exit code 1)",
      });
      process.exit(1);
    }, 5_000);

    if (reason !== undefined) {
      common.logger.warn({
        service: "process",
        msg: `${reason}, starting shutdown sequence`,
      });
    }
    common.telemetry.record({
      event: "App Killed",
      properties: { processDuration: process.uptime() },
    });

    await cleanup();

    common.logger.fatal({
      service: "process",
      msg: "Finished shutdown sequence, terminating (exit code 0)",
    });

    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("Received SIGINT"));
  process.on("SIGQUIT", () => shutdown("Received SIGQUIT"));
  process.on("SIGTERM", () => shutdown("Received SIGTERM"));
  process.on("uncaughtException", async (error: Error) => {
    common.logger.error({
      service: "process",
      msg: "Caught uncaughtException event with error:",
      error,
    });
    await shutdown("Received uncaughtException");
  });
  process.on("unhandledRejection", async (error: Error) => {
    common.logger.error({
      service: "process",
      msg: "Caught unhandledRejection event with error:",
      error,
    });
    await shutdown("Received unhandledRejection");
  });

  return shutdown;
}
