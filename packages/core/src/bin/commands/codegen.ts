import { runCodegen } from "@/bin/utils/codegen.js";
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

  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) {
    logger.error({
      msg: "Invalid Node.js version",
      version: process.versions.node,
      expected: "22",
    });

    process.exit(1);
  }

  const metrics = new MetricsService();
  const shutdown = createShutdown();
  const telemetry = createTelemetry({ options, logger, shutdown });
  const common = {
    options,
    logger,
    metrics,
    telemetry,
    shutdown,
    buildShutdown: shutdown,
    apiShutdown: shutdown,
  };

  const exit = createExit({ common, options });

  telemetry.record({
    name: "lifecycle:session_start",
    properties: { cli_command: "codegen" },
  });

  runCodegen({ common });

  logger.info({ msg: `Wrote file "ponder-env.d.ts"` });

  await exit({ code: 0 });
}
