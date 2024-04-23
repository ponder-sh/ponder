import type { Common } from "@/common/common.js";
import { IgnorableError, NonRetryableError } from "@/common/errors.js";
import { startClock } from "@/utils/timer.js";
import { Kysely, type KyselyConfig, type KyselyProps } from "kysely";

const RETRY_COUNT = 3;
const BASE_DURATION = 100;

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
    let firstError: any;
    let hasError = false;

    for (let i = 0; i < RETRY_COUNT + 1; i++) {
      const endClock = startClock();
      try {
        const result = await fn();
        this.common.metrics.ponder_database_method_duration.observe(
          { service: this.name, method: options.method },
          endClock(),
        );
        return result;
      } catch (e) {
        const error = e as Error;

        this.common.metrics.ponder_database_method_duration.observe(
          { service: this.name, method: options.method },
          endClock(),
        );
        this.common.metrics.ponder_database_method_error_total.inc({
          service: this.name,
          method: options.method,
        });

        if (this.isKilled) {
          this.common.logger.trace({
            service: this.name,
            msg: `Ignored error during '${options.method}' (service is killed)`,
          });
          throw new IgnorableError();
        }

        if (error instanceof NonRetryableError) {
          throw error;
        }

        if (!hasError) {
          hasError = true;
          firstError = error;
        }

        if (i < RETRY_COUNT) {
          const duration = BASE_DURATION * 2 ** i;
          this.common.logger.warn({
            service: this.name,
            msg: `Database error during '${options.method}', retrying after ${duration} milliseconds. Error: ${firstError.message}`,
          });
          await new Promise((_resolve) => {
            setTimeout(_resolve, duration);
          });
        }
      }
    }

    throw firstError;
  };
}
