"use client";

import { type Client, status } from "@ponder/client";
import { compileQuery } from "@ponder/client";
import {
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useContext, useEffect, useMemo } from "react";
import { PonderContext } from "./context.js";

type SQLWrapper = Exclude<Parameters<typeof compileQuery>[0], string>;

export function getQueryKey(query: SQLWrapper) {
  const sql = compileQuery(query);
  return [sql.sql, ...sql.params];
}

export function usePonderQuery<result>(
  params: {
    queryFn: (db: Client["db"]) => Promise<result> & SQLWrapper;
  } & Omit<UseQueryOptions<result>, "queryFn" | "queryKey">,
): UseQueryResult<result> {
  const queryClient = useQueryClient();

  const client = useContext(PonderContext);
  if (client === undefined) {
    throw new Error("PonderProvider not found");
  }

  // TODO(kyle) potentialy use a different db instance that doesn't decode
  const queryPromise = params.queryFn(client.db);

  if ("getSQL" in queryPromise === false) {
    throw new Error('"queryFn" must return SQL');
  }

  const query = compileQuery(queryPromise);
  const queryKey = useMemo(() => [query.sql, ...query.params], [query]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    const { unsubscribe } = client.live(
      (db) => db.select().from(status),
      () => queryClient.invalidateQueries({ queryKey }),
    );
    return unsubscribe;
  }, [queryKey]);

  // TODO(kyle) use select() to decode

  return useQuery({
    ...params,
    queryKey,
    queryFn: () => queryPromise,
  });
}
