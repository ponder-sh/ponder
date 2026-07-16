import type { Logger } from "./logger.js";
import type { MetricsService } from "./metrics.js";
import type { Options } from "./options.js";
import type { Shutdown } from "./shutdown.js";

export type Common = {
  options: Options;
  logger: Logger;
  metrics: MetricsService;
  shutdown: Shutdown;
  apiShutdown: Shutdown;
  buildShutdown: Shutdown;
};
