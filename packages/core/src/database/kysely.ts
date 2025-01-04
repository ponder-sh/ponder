import type { Common } from "@/common/common.js";
import { IgnorableError, NonRetryableError } from "@/common/errors.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import { Kysely, type KyselyConfig, type KyselyProps } from "kysely";

const RETRY_COUNT = 9;
const BASE_DURATION = 125;

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

  wrap = async <T>(
    options: { method: string; shouldRetry?: (error: Error) => boolean },
    fn: () => Promise<T>,
    // TypeScript can't infer that we always return or throw.
    // @ts-ignore
  ): Promise<T> => {
    // First error thrown is often the most useful
    let firstError: any;
    let hasError = false;

    for (let i = 0; i <= RETRY_COUNT; i++) {
      const endClock = startClock();
      try {
        const result = await fn();
        this.common.metrics.ponder_database_method_duration.observe(
          { service: this.name, method: options.method },
          endClock(),
        );
        return result;
      } catch (_error) {
        const error = _error as Error;

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
            msg: `Ignored error during '${options.method}' database method (service is killed)`,
          });
          throw new IgnorableError();
        }

        if (!hasError) {
          hasError = true;
          firstError = error;
        }

        if (
          error instanceof NonRetryableError ||
          options.shouldRetry?.(error) === false
        ) {
          this.common.logger.warn({
            service: this.name,
            msg: `Failed '${options.method}' database method `,
          });
          throw error;
        }

        if (i === RETRY_COUNT) {
          this.common.logger.warn({
            service: this.name,
            msg: `Failed '${options.method}' database method after '${i + 1}' attempts`,
            error,
          });
          throw firstError;
        }

        const duration = BASE_DURATION * 2 ** i;
        this.common.logger.debug({
          service: this.name,
          msg: `Failed '${options.method}' database method, retrying after ${duration} milliseconds`,
          error,
        });
        await wait(duration);
      }
    }
  };
}
