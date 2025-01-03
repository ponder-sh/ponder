import type { Logger } from "./logger.js";
import type { MetricsService } from "./metrics.js";
import type { Options } from "./options.js";
import type { Telemetry } from "./telemetry.js";

export type Common = {
  options: Options;
  logger: Logger;
  metrics: MetricsService;
  telemetry: Telemetry;
};
