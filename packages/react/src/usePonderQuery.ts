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

export function usePonderQuery<result>(
  params: {
    queryFn: (db: Client["db"]) => Promise<result>;
  } & Omit<UseQueryOptions<result>, "queryFn" | "queryKey">,
): UseQueryResult<result> {
  const queryClient = useQueryClient();

  const client = useContext(PonderContext);
  if (client === undefined) {
    throw new Error("PonderProvider not found");
  }

  const queryPromise = params.queryFn(client.db);
  // @ts-ignore
  const query = compileQuery(queryPromise);
  const queryKey = useMemo(() => [query.sql, ...query.params], [query]);

  useEffect(() => {
    const { unsubscribe } = client.live(
      (db) => db.select().from(status),
      () => queryClient.invalidateQueries({ queryKey }),
    );
    return unsubscribe;
  }, [queryClient, client, queryKey]);

  return useQuery({
    ...params,
    queryKey,
    queryFn: () => queryPromise,
  });
}
