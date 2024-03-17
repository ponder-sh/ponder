import type { LoggerService } from "./logger.js";
import type { MetricsService } from "./metrics.js";
import type { Options } from "./options.js";
import type { TelemetryService } from "./telemetry.js";

export type Common = {
  options: Options;
  logger: LoggerService;
  metrics: MetricsService;
  telemetry: TelemetryService;
};
