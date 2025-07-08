"use client";

import { type Client, type Status, compileQuery } from "@ponder/client";
import {
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useContext, useEffect, useMemo } from "react";
import { stringify } from "superjson";
import { PonderContext } from "./context.js";
import { type SQLWrapper, getPonderQueryOptions } from "./utils.js";

export function usePonderQuery<result>(
  params: {
    queryFn: (db: Client["db"]) => Promise<result>;
  } & Omit<UseQueryOptions<result>, "queryFn" | "queryKey">,
): UseQueryResult<result> {
  const queryClient = useQueryClient();

  const client = usePonderClient();

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

export function usePonderClient(): Client {
  const client = useContext(PonderContext);
  if (client === undefined) {
    throw new Error("PonderProvider not found");
  }
  return client;
}

export function usePonderQueryOptions<T>(queryFn: (db: Client["db"]) => T): {
  queryKey: QueryKey;
  queryFn: () => T;
} {
  const client = usePonderClient();

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
