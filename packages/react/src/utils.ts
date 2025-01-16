import { type Client, compileQuery } from "@ponder/client";
import type { UseQueryOptions } from "@tanstack/react-query";

export type SQLWrapper = Exclude<Parameters<typeof compileQuery>[0], string>;

export function getQueryKey(query: SQLWrapper) {
  const sql = compileQuery(query);
  return [sql.sql, ...sql.params];
}

export function getPonderQueryOptions<result>(
  client: Client,
  queryFn: (db: Client["db"]) => Promise<result> & SQLWrapper,
): Required<Pick<UseQueryOptions<result>, "queryKey" | "queryFn">> {
  const queryPromise = queryFn(client.db);

  if ("getSQL" in queryPromise === false) {
    throw new Error('"queryFn" must return SQL');
  }

  const query = compileQuery(queryPromise);
  const queryKey = [query.sql, ...query.params];

  return {
    queryKey,
    queryFn: () => queryPromise,
  };
}
