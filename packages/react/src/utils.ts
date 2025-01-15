import { compileQuery } from "@ponder/client";

export type SQLWrapper = Exclude<Parameters<typeof compileQuery>[0], string>;

export function getQueryKey(query: SQLWrapper) {
  const sql = compileQuery(query);
  return [sql.sql, ...sql.params];
}
