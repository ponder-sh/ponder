import { desc, status } from "@ponder/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { client, schema } from "./index";

export type Deposit = NonNullable<
  ReturnType<typeof useDeposits>["data"]
>[number];

export const useDeposits = () => {
  const queryClient = useQueryClient();
  const queryKey = ["weth deposits"];

  useEffect(() => {
    const { unsubscribe } = client.live(
      (db) => db.select().from(status).limit(10),
      () => queryClient.invalidateQueries({ queryKey }),
      (error) => {
        console.error(error);
      },
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  return useQuery({
    queryKey,
    queryFn: () =>
      client.db
        .select({
          timestamp: schema.depositEvent.timestamp,
          account: schema.depositEvent.account,
          amount: schema.depositEvent.amount,
        })
        .from(schema.depositEvent)
        .orderBy(desc(schema.depositEvent.timestamp))
        .limit(10),
    staleTime: Number.POSITIVE_INFINITY,
  });
};
