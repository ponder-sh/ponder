import os from "node:os";
import readline from "node:readline";
import type { Common } from "@/internal/common.js";
import { NonRetryableUserError, ShutdownError } from "@/internal/errors.js";
import type { Options } from "@/internal/options.js";

const SHUTDOWN_GRACE_PERIOD_MS = 5_000;

/** Sets up shutdown handlers for the process. Accepts additional cleanup logic to run. */
export const createExit = ({
  common,
  options,
}: {
  common: Pick<
    Common,
    "logger" | "telemetry" | "shutdown" | "buildShutdown" | "apiShutdown"
  >;
  options: Options;
}) => {
  let isShuttingDown = false;

  const exit = async ({ code }: { code: 0 | 1 | 75 }) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    const timeout = setTimeout(async () => {
      common.logger.error({
        msg: "Failed to shutdown within 5 seconds",
        code,
      });
      process.exit(code);
    }, SHUTDOWN_GRACE_PERIOD_MS);

    common.logger.warn({
      msg: "Started shutdown sequence",
    });

    common.telemetry.record({
      name: "lifecycle:session_end",
      properties: { duration_seconds: process.uptime() },
    });

    await Promise.all([
      common.shutdown.kill(),
      common.apiShutdown.kill(),
      common.buildShutdown.kill(),
    ]);
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
    readlineInterface.on("SIGINT", () => {
      if (isShuttingDown) return;
      common.logger.warn({ msg: "Received SIGINT" });
      exit({ code: 0 });
    });
  }

  process.on("SIGINT", () => {
    if (isShuttingDown) return;
    common.logger.warn({ msg: "Received SIGINT" });
    exit({ code: 0 });
  });
  process.on("SIGTERM", () => {
    if (isShuttingDown) return;
    common.logger.warn({ msg: "Received SIGTERM" });
    exit({ code: 0 });
  });
  process.on("SIGQUIT", () => {
    if (isShuttingDown) return;
    common.logger.warn({ msg: "Received SIGQUIT" });
    exit({ code: 0 });
  });
  if (options.command !== "dev") {
    process.on("uncaughtException", (error: Error) => {
      if (error instanceof ShutdownError) return;
      common.logger.error({
        msg: "uncaughtException",
        error,
      });
      if (error instanceof NonRetryableUserError) {
        exit({ code: 1 });
      } else {
        exit({ code: 75 });
      }
    });
    process.on("unhandledRejection", (error: Error) => {
      if (error instanceof ShutdownError) return;
      common.logger.error({
        msg: "unhandledRejection",
        error,
      });
      if (error instanceof NonRetryableUserError) {
        exit({ code: 1 });
      } else {
        exit({ code: 75 });
      }
    });
  }

  return exit;
};
