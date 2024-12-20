import { desc } from "@ponder/client";
import { useQuery } from "@tanstack/react-query";
import { client, schema } from "./index";

export type Deposit = NonNullable<
  ReturnType<typeof useDeposits>["data"]
>[number];

export const useDeposits = () => {
  return useQuery({
    queryKey: ["weth deposits"],
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
    refetchInterval: 1_000,
  });
};
