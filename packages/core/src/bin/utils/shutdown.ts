import type { Common } from "@/common/common.js";

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
  }: { reason: string; code: number }) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    setTimeout(() => {
      common.logger.fatal({
        service: "process",
        msg: "Failed to shutdown within 5 seconds, terminating (exit code 1)",
      });
      process.exit(1);
    }, SHUTDOWN_GRACE_PERIOD_MS);

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
      msg: `Finished shutdown sequence, terminating (exit code ${code})`,
    });

    process.exit(code);
  };

  process.on(
    "SIGINT",
    async () => await shutdown({ reason: "Received SIGINT", code: 0 }),
  );
  process.on(
    "SIGTERM",
    async () => await shutdown({ reason: "Received SIGTERM", code: 0 }),
  );
  process.on(
    "SIGQUIT",
    async () => await shutdown({ reason: "Received SIGQUIT", code: 0 }),
  );

  process.on("uncaughtException", async (error: Error) => {
    common.logger.error({
      service: "process",
      msg: "Caught uncaughtException event with error:",
      error,
    });
    await shutdown({ reason: "Received uncaughtException", code: 1 });
  });
  process.on("unhandledRejection", async (error: Error) => {
    common.logger.error({
      service: "process",
      msg: "Caught unhandledRejection event with error:",
      error,
    });
    await shutdown({ reason: "Received unhandledRejection", code: 1 });
  });

  return shutdown;
}
