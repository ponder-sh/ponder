"use client";

import type { Client, Status } from "@ponder/client";
import {
  type DefaultError,
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useContext, useEffect, useMemo } from "react";
import { PonderContext } from "./context.js";
import type { ResolvedSchema } from "./index.js";
import { getPonderQueryOptions } from "./utils.js";

export function usePonderQuery<
  queryFnData = unknown,
  error = DefaultError,
  data = queryFnData,
>(
  params: {
    queryFn: (db: Client<ResolvedSchema>["db"]) => Promise<queryFnData>;
  } & Omit<UseQueryOptions<queryFnData, error, data>, "queryFn" | "queryKey">,
): UseQueryResult<data, error> {
  const queryClient = useQueryClient();

  const client = usePonderClient();

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  const queryOptions = useMemo(
    () => getPonderQueryOptions(client, params.queryFn),
    [params.queryFn],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    const { unsubscribe } = client.live(queryOptions.queryFn, (data) => {
      queryClient.setQueryData(queryOptions.queryKey, data);
    });
    return unsubscribe;
  }, queryOptions.queryKey);

  return useQuery({
    ...params,
    queryKey: queryOptions.queryKey,
    queryFn: queryOptions.queryFn,
    staleTime: params.staleTime ?? Number.POSITIVE_INFINITY,
  });
}

export function usePonderClient(): Client<ResolvedSchema> {
  const client = useContext(PonderContext);
  if (client === undefined) {
    throw new Error("PonderProvider not found");
  }
  return client;
}

export function usePonderQueryOptions<T>(
  queryFn: (db: Client<ResolvedSchema>["db"]) => T,
): {
  queryKey: QueryKey;
  queryFn: () => T;
} {
  const client = usePonderClient();
  return getPonderQueryOptions(client, queryFn);
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

  // TODO(kyle)  SELECT * FROM _ponder_checkpoint;

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    const { unsubscribe } = client.live(client.getStatus, (data) => {
      queryClient.setQueryData(statusQueryKey, data);
    });
    return unsubscribe;
  }, []);

  return useQuery({
    ...params,
    queryKey: statusQueryKey,
    queryFn: () => client.getStatus(),
    staleTime: params.staleTime ?? Number.POSITIVE_INFINITY,
  });
}
