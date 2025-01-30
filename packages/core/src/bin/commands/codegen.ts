import { runCodegen } from "@/bin/utils/codegen.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createTelemetry } from "@/internal/telemetry.js";
import type { CliOptions } from "../ponder.js";
import { setupShutdown } from "../utils/shutdown.js";

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
    await logger.kill();
    process.exit(1);
  }

  const metrics = new MetricsService();
  const telemetry = createTelemetry({ options, logger });
  const common = { options, logger, metrics, telemetry };

  const cleanup = async () => {
    await telemetry.kill();
  };

  const shutdown = setupShutdown({ common, cleanup });

  telemetry.record({
    name: "lifecycle:session_start",
    properties: { cli_command: "codegen" },
  });

  runCodegen({ common });

  logger.info({ service: "codegen", msg: "Wrote ponder-env.d.ts" });

  await shutdown({ reason: "Success", code: 0 });
}
