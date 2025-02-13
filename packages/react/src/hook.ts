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
import { getPonderQueryOptions } from "./utils.js";

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  const queryOptions = useMemo(
    () => getPonderQueryOptions(client, params.queryFn),
    [params.queryFn],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    const { unsubscribe } = client.live(
      () => Promise.resolve(),
      () => queryClient.invalidateQueries({ queryKey: queryOptions.queryKey }),
    );
    return unsubscribe;
  }, queryOptions.queryKey);

  return useQuery({
    ...params,
    queryKey: queryOptions.queryKey,
    queryFn: queryOptions.queryFn,
  });
}

const statusQueryKey = ["status"];

export function usePonderStatus(
  params: Omit<UseQueryOptions<Status>, "queryFn" | "queryKey">,
): UseQueryResult<Status> {
  const queryClient = useQueryClient();

  const client = useContext(PonderContext);
  if (client === undefined) {
    throw new Error("PonderProvider not found");
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    const { unsubscribe } = client.live(
      () => Promise.resolve(),
      () => queryClient.invalidateQueries({ queryKey: statusQueryKey }),
    );
    return unsubscribe;
  }, []);

  return useQuery({
    ...params,
    queryKey: statusQueryKey,
    queryFn: () => client.getStatus(),
  });
}
