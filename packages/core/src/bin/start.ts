import path from "node:path";
import { BuildService } from "@/build/service.js";
import { LoggerService } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { TelemetryService } from "@/common/telemetry.js";
import dotenv from "dotenv";
import type { CliOptions } from "./ponder.js";
import { run, setupShutdown } from "./shared.js";

export async function start({ cliOptions }: { cliOptions: CliOptions }) {
  dotenv.config({ path: ".env.local" });
  const options = buildOptions({ cliOptions });

  // TODO(kevin) should make a helper function for this

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

  const configRelPath = path.relative(options.rootDir, options.configFile);
  logger.debug({
    service: "app",
    msg: `Started using config file: ${configRelPath}`,
  });

  const metrics = new MetricsService();
  const telemetry = new TelemetryService({ options });
  const common = { options, logger, metrics, telemetry };

  const buildService = new BuildService({ common });
  await buildService.setup({ watch: false });

  let cleanupReloadable = () => Promise.resolve();

  const cleanup = async () => {
    await cleanupReloadable();
    await buildService.kill();
    await telemetry.kill();
  };

  const shutdown = setupShutdown({ common, cleanup });

  const initialResult = await buildService.initialLoad();
  if (initialResult.error) {
    logger.error({
      service: "process",
      msg: "Failed initial build with error:",
      error: initialResult.error,
    });
    return shutdown("Failed intial build");
  }

  telemetry.record({
    event: "App Started",
    properties: {
      command: "ponder start",
      contractCount: initialResult.build.sources.length,
      databaseKind: initialResult.build.databaseConfig.kind,
    },
  });

  cleanupReloadable = await run({
    common,
    build: initialResult.build,
    onFatalError: () => {
      shutdown("Received fatal error");
    },
    onReloadableError: () => {
      shutdown("Encountered indexing error");
    },
  });
}
