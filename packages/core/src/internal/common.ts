import type { Logger } from "./logger.js";
import type { AggregatorMetricsService, MetricsService } from "./metrics.js";
import type { Options } from "./options.js";
import type { Shutdown } from "./shutdown.js";
import type { Telemetry } from "./telemetry.js";

export type Common = {
  options: Options;
  logger: Logger;
  metrics: MetricsService | AggregatorMetricsService;
  telemetry: Telemetry;
  shutdown: Shutdown;
};
