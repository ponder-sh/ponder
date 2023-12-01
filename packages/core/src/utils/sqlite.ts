import BetterSqlite3 from "better-sqlite3";

import { prettyPrint } from "./print.js";

export function improveSqliteErrors(database: BetterSqlite3.Database) {
  const originalPrepare = database.prepare;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  database.prepare = (source: string) => {
    const statement = originalPrepare.apply(database, [source]);
    const wrapper =
      (fn: (...args: any) => void) =>
      (...args: any) => {
        try {
          return fn.apply(statement, args);
        } catch (error_) {
          const error = error_ as Error & { detail?: string; meta?: string };
          error.name = "SqliteError";

          let parameters = (args[0] ?? []) as string[];
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
          metaMessages.push(`Statement:\n  ${source}`);
          metaMessages.push(`Parameters:\n${prettyPrint(params)}`);

          error.meta = metaMessages.join("\n");

          throw error;
        }
      };

    for (const method of ["run", "get", "all"]) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      statement[method] = wrapper(statement[method]);
    }

    return statement;
  };
}

export { BetterSqlite3 };
