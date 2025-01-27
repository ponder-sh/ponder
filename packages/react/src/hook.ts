"use client";

import type { Client, Status } from "@ponder/client";
import {
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useContext, useEffect, useMemo } from "react";
import { PonderContext } from "./context.js";
import { type SQLWrapper, getPonderQueryOptions } from "./utils.js";

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

  const { queryFn, queryKey } = getPonderQueryOptions(client, params.queryFn);
  const memoizedQueryKey = useMemo(() => queryKey, [queryKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    if (params.enabled === false) return;
    const { unsubscribe } = client.live(
      () => Promise.resolve(),
      () => queryClient.invalidateQueries({ queryKey: memoizedQueryKey }),
    );
    return unsubscribe;
  }, [memoizedQueryKey, params.enabled]);

  return useQuery({
    ...params,
    queryKey: memoizedQueryKey,
    queryFn,
  });
}

export function usePonderStatus(
  params: Omit<UseQueryOptions<Status>, "queryFn" | "queryKey">,
): UseQueryResult<Status> {
  const queryClient = useQueryClient();

  const client = useContext(PonderContext);
  if (client === undefined) {
    throw new Error("PonderProvider not found");
  }

  const queryKey = useMemo(() => ["status"], []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    const { unsubscribe } = client.live(
      () => Promise.resolve(),
      () => queryClient.invalidateQueries({ queryKey }),
    );
    return unsubscribe;
  }, []);

  return useQuery({
    ...params,
    queryKey,
    queryFn: () => client.getStatus(),
  });
}
