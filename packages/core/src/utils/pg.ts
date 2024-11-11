import pg, { type PoolConfig } from "pg";
import { prettyPrint } from "./print.js";

// Monkeypatch Pool.query to get more informative stack traces. I have no idea why this works.
// https://stackoverflow.com/a/70601114
const originalClientQuery = pg.Client.prototype.query;
// @ts-ignore
pg.Client.prototype.query = function query(
  ...args: [queryText: string, values: any[], callback: () => void]
) {
  try {
    return originalClientQuery.apply(this, args as any);
  } catch (error_) {
    const error = error_ as Error & { detail?: string; meta?: string[] };
    const [statement, parameters_] = args ?? ["empty", []];

    error.name = "PostgresError";

    let parameters = parameters_ ?? [];
    parameters =
      parameters.length <= 25
        ? parameters
        : parameters.slice(0, 26).concat(["..."]);
    const params = parameters.reduce<Record<number, any>>(
      (acc, parameter, idx) => {
        acc[idx + 1] = parameter;
        return acc;
      },
      {},
    );

    error.meta = Array.isArray(error.meta) ? error.meta : [];
    if (error.detail) error.meta.push(`Detail:\n  ${error.detail}`);
    error.meta.push(`Statement:\n  ${statement}`);
    error.meta.push(`Parameters:\n${prettyPrint(params)}`);

    throw error;
  }
};

class ReadonlyClient extends pg.Client {
  // @ts-expect-error
  override connect(
    callback: (err: Error) => void | undefined,
  ): void | Promise<void> {
    if (callback) {
      super.connect(() => {
        this.query(
          "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY",
          callback,
        );
      });
    } else {
      return super.connect().then(async () => {
        await this.query(
          "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY",
        );
      });
    }
  }
}

export function createPool(config: PoolConfig) {
  return new pg.Pool({
    // https://stackoverflow.com/questions/59155572/how-to-set-query-timeout-in-relation-to-statement-timeout
    statement_timeout: 2 * 60 * 1000, // 2 minutes
    ...config,
  });
}

export function createReadonlyPool(config: PoolConfig) {
  return new pg.Pool({
    // https://stackoverflow.com/questions/59155572/how-to-set-query-timeout-in-relation-to-statement-timeout
    statement_timeout: 2 * 60 * 1000, // 2 minutes
    // @ts-expect-error: The custom Client is an undocumented option.
    Client: ReadonlyClient,
    ...config,
  });
}
