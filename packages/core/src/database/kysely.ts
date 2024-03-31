import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import { startClock } from "@/utils/timer.js";
import { Kysely, type KyselyConfig, type KyselyProps } from "kysely";

export class HeadlessKysely<DB> extends Kysely<DB> {
  private common: Common;
  private name: string;
  private isKilled = false;

  constructor({
    common,
    name,
    ...args
  }: (KyselyConfig | KyselyProps) & { name: string; common: Common }) {
    super(args);
    this.common = common;
    this.name = name;
  }

  override async destroy() {
    this.isKilled = true;
  }

  wrap = async <T>(options: { method: string }, fn: () => Promise<T>) => {
    const endClock = startClock();
    const RETRY_COUNT = 3;
    const BASE_DURATION = 100;

    let error: any;
    let hasError = false;

    for (let i = 0; i < RETRY_COUNT + 1; i++) {
      try {
        const result = await fn();
        this.common.metrics.ponder_database_method_duration.observe(
          { service: this.name, method: options.method },
          endClock(),
        );
        return result;
      } catch (_error) {
        if (this.isKilled || _error instanceof NonRetryableError) {
          throw _error;
        }

        if (!hasError) {
          hasError = true;
          error = _error;
        }

        if (i < RETRY_COUNT) {
          const duration = BASE_DURATION * 2 ** i;
          this.common.logger.warn({
            service: this.name,
            msg: `Database error while running ${options.method}, retrying after ${duration} milliseconds. Error: ${error.message}`,
          });
          await new Promise((_resolve) => {
            setTimeout(_resolve, duration);
          });
        }
      }
    }

    this.common.metrics.ponder_database_method_error_total.inc({
      service: this.name,
      method: options.method,
    });

    throw error;
  };
}
