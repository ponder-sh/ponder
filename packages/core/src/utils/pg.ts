import pg from "pg";

import { prettyPrint } from "./print.js";

// Set pg protocol to use BigInt for `numeric` types.
// See https://github.com/brianc/node-pg-types for details.
pg.types.setTypeParser(1700, BigInt);

// Monkeypatch Pool.query to get more informative stack traces. I have no idea why this works.
// https://stackoverflow.com/a/70601114
const originalClientQuery = pg.Client.prototype.query;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
pg.Client.prototype.query = async function query(
  ...args: [queryText: string, values: any[], callback: () => void]
) {
  try {
    return await originalClientQuery.apply(this, args);
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

export default pg;
export type * from "pg";
