import { type Client, compileQuery } from "@ponder/client";
import type { QueryKey } from "@tanstack/react-query";
import { stringify } from "superjson";
import type { ResolvedSchema } from "./index.js";

export type SQLWrapper = Exclude<Parameters<typeof compileQuery>[0], string>;

export function getPonderQueryOptions<T>(
  client: Client<ResolvedSchema>,
  queryFn: (db: Client<ResolvedSchema>["db"]) => T,
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

export const getQueryKey = (query: SQLWrapper) => {
  const compiledQuery = compileQuery(query);
  return ["__ponder_react", compiledQuery.sql, stringify(compiledQuery.params)];
};
