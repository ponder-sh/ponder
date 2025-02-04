import { type Client, compileQuery } from "@ponder/client";
import type { QueryKey } from "@tanstack/react-query";
import { stringify } from "superjson";

export type SQLWrapper = Exclude<Parameters<typeof compileQuery>[0], string>;

export function getPonderQueryOptions<result>(
  client: Client,
  queryFn: (db: Client["db"]) => Promise<result> & SQLWrapper,
): {
  queryKey: QueryKey;
  queryFn: () => Promise<result> & SQLWrapper;
} {
  const queryPromise = queryFn(client.db);

  if ("getSQL" in queryPromise === false) {
    throw new Error('"queryFn" must return SQL');
  }

  const query = compileQuery(queryPromise);
  const queryKey = ["__ponder_react", query.sql, stringify(query.params)];

  return {
    queryKey,
    queryFn: () => queryPromise,
  };
}
