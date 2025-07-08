import { type Client, compileQuery } from "@ponder/client";
import type { QueryKey } from "@tanstack/react-query";
import { stringify } from "superjson";

export type SQLWrapper = Exclude<Parameters<typeof compileQuery>[0], string>;

export function getPonderQueryOptions<T>(
  client: Client,
  queryFn: (db: Client["db"]) => T,
): {
  queryKey: QueryKey;
  queryFn: () => T;
} {
  const queryPromise = queryFn(client.db);

  // @ts-expect-error
  if ("getSQL" in queryPromise === false) {
    throw new Error('"queryFn" must return SQL');
  }

  const query = compileQuery(queryPromise as unknown as SQLWrapper);
  const queryKey = ["__ponder_react", query.sql, stringify(query.params)];

  return {
    queryKey,
    queryFn: () => queryPromise,
  };
}
