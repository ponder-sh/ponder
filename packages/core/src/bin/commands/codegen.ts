import { BuildService } from "@/build/service.js";
import { runCodegen } from "@/common/codegen.js";
import { LoggerService } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { TelemetryService } from "@/common/telemetry.js";
import dotenv from "dotenv";
import type { CliOptions } from "../ponder.js";
import { setupShutdown } from "../utils/shutdown.js";

export async function codegen({ cliOptions }: { cliOptions: CliOptions }) {
  dotenv.config({ path: ".env.local" });
  const options = buildOptions({ cliOptions });

  const logger = new LoggerService({
    level: options.logLevel,
    dir: options.logDir,
  });

  const [major, minor, _patch] = process.versions.node.split(".").map(Number);
  if (major < 18 || (major === 18 && minor < 14)) {
    logger.fatal({
      service: "process",
      msg: `Invalid Node.js version. Expected >=18.14, detected ${major}.${minor}.`,
    });
    process.exit(1);
  }

  const metrics = new MetricsService();
  const telemetry = new TelemetryService({ options });
  const common = { options, logger, metrics, telemetry };

  const buildService = new BuildService({ common });
  await buildService.setup({ watch: false });

  const cleanup = async () => {
    await buildService.kill();
    await telemetry.kill();
  };

  const shutdown = setupShutdown({ common, cleanup });

  const schemaResult = await buildService.loadSchema();
  if (schemaResult.error) {
    logger.error({
      service: "process",
      msg: "Failed schema build with error:",
      error: schemaResult.error,
    });
    await shutdown({ reason: "Failed schema build", code: 1 });
    return;
  }

  runCodegen({ common, graphqlSchema: schemaResult.graphqlSchema });

  logger.info({ service: "codegen", msg: "Wrote ponder-env.d.ts" });
  logger.info({ service: "codegen", msg: "Wrote schema.graphql" });

  await shutdown({ reason: "Success", code: 0 });
}
