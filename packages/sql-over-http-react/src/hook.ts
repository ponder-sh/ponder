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
import { decodeCheckpoint } from "./checkpoint.js";
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
    live?: boolean;
  } & Omit<UseQueryOptions<queryFnData, error, data>, "queryFn" | "queryKey">,
): UseQueryResult<data, error> {
  const live = params.live ?? true;
  const queryClient = useQueryClient();

  const client = usePonderClient();

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  const queryOptions = useMemo(
    () => getPonderQueryOptions(client, params.queryFn),
    [params.queryFn],
  );

  useEffect(() => {
    if (live === false || params.enabled === false) return;

    const { unsubscribe } = client.live(queryOptions.queryFn, (data) => {
      queryClient.setQueryData(queryOptions.queryKey, data);
    });
    return unsubscribe;
  }, [
    live,
    params.enabled,
    client,
    queryOptions.queryFn,
    queryOptions.queryKey,
    queryClient,
  ]);

  return useQuery({
    ...params,
    queryKey: queryOptions.queryKey,
    queryFn: queryOptions.queryFn,
    staleTime: live
      ? (params.staleTime ?? Number.POSITIVE_INFINITY)
      : params.staleTime,
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

export function usePonderStatus<error = DefaultError>(
  params?: { live?: boolean } & Omit<
    UseQueryOptions<
      { chain_name: string; chain_id: number; latest_checkpoint: string }[],
      error,
      Status
    >,
    "queryFn" | "queryKey" | "select"
  >,
): UseQueryResult<Status, error> {
  return usePonderQuery<
    { chain_name: string; chain_id: number; latest_checkpoint: string }[],
    error,
    Status
  >({
    ...params,
    queryFn: (db) => db.execute("SELECT * FROM _ponder_checkpoint"),
    select(checkpoints) {
      const status: Status = {};
      for (const {
        chain_name,
        chain_id,
        latest_checkpoint,
      } of checkpoints.sort((a, b) => (a.chain_id > b.chain_id ? 1 : -1))) {
        status[chain_name] = {
          id: chain_id,
          block: {
            number: Number(decodeCheckpoint(latest_checkpoint).blockNumber),
            timestamp: Number(
              decodeCheckpoint(latest_checkpoint).blockTimestamp,
            ),
          },
        };
      }

      return status;
    },
  });
}
