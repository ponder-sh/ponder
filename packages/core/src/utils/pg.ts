import pg, { type PoolConfig } from "pg";
import { prettyPrint } from "./print.js";

// See https://github.com/brianc/node-pg-types for details.
// Use BigInt for `numeric` types.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, BigInt);
// Use Number for `bigint`/`int8` types. We use these for chain IDs.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

// Monkeypatch Pool.query to get more informative stack traces. I have no idea why this works.
// https://stackoverflow.com/a/70601114
const originalClientQuery = pg.Client.prototype.query;
// @ts-ignore
pg.Client.prototype.query = function query(
  ...args: [queryText: string, values: any[], callback: () => void]
) {
  try {
    return originalClientQuery.apply(this, args);
  } catch (error_) {
    const error = error_ as Error & { detail?: string; meta?: string };
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

    const metaMessages = [];
    if (error.detail) metaMessages.push(`Detail:\n  ${error.detail}`);
    metaMessages.push(`Statement:\n  ${statement}`);
    metaMessages.push(`Parameters:\n${prettyPrint(params)}`);

    error.meta = metaMessages.join("\n");

    throw error;
  }
};

export function createPool(config: PoolConfig) {
  return new pg.Pool({
    // https://stackoverflow.com/questions/59155572/how-to-set-query-timeout-in-relation-to-statement-timeout
    statement_timeout: 30_000,
    ...config,
  });
}
