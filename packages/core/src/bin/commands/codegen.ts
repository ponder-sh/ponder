import { runCodegen } from "@/bin/utils/codegen.js";
import { NonRetryableUserError, ShutdownError } from "@/internal/errors.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { createTelemetry } from "@/internal/telemetry.js";
import type { CliOptions } from "../ponder.js";
import { createExit } from "../utils/exit.js";

export async function codegen({ cliOptions }: { cliOptions: CliOptions }) {
  const options = buildOptions({ cliOptions });

  const logger = createLogger({
    level: options.logLevel,
    mode: options.logFormat,
  });

  const [major, minor, _patch] = process.versions.node
    .split(".")
    .map(Number) as [number, number, number];
  if (major < 18 || (major === 18 && minor < 14)) {
    logger.fatal({
      service: "process",
      msg: `Invalid Node.js version. Expected >=18.14, detected ${major}.${minor}.`,
    });

    process.exit(1);
  }

  const metrics = new MetricsService();
  const shutdown = createShutdown();
  const telemetry = createTelemetry({ options, logger, shutdown });
  const common = { options, logger, metrics, telemetry, shutdown };

  const exit = createExit({ common });

  process.on("uncaughtException", (error: Error) => {
    if (error instanceof ShutdownError) return;
    if (error instanceof NonRetryableUserError) {
      exit({ reason: "Received fatal error", code: 1 });
    } else {
      exit({ reason: "Received fatal error", code: 75 });
    }
  });
  process.on("unhandledRejection", (error: Error) => {
    if (error instanceof ShutdownError) return;
    if (error instanceof NonRetryableUserError) {
      exit({ reason: "Received fatal error", code: 1 });
    } else {
      exit({ reason: "Received fatal error", code: 75 });
    }
  });

  telemetry.record({
    name: "lifecycle:session_start",
    properties: { cli_command: "codegen" },
  });

  runCodegen({ common });

  logger.info({ service: "codegen", msg: "Wrote ponder-env.d.ts" });

  await exit({ reason: "Success", code: 0 });
}
