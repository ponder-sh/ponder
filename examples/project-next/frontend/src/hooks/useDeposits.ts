import { useQuery } from "@tanstack/react-query";
import { GraphQLClient } from "graphql-request";

import { DepositsQueryDocument } from "@/graphql/generated/graphql";

const client = new GraphQLClient("http://localhost:42069");

export const useDeposits = () => {
  return useQuery({
    queryKey: ["weth deposits"],
    queryFn: async () => {
      const r = await client.request(DepositsQueryDocument);
      return r.depositEvents.map((d) => ({
        id: d.id,
        timestamp: d.timestamp,
        account: d.account,
        amount: BigInt(d.amount),
      }));
    },
    staleTime: Infinity,
    refetchInterval: 1_000,
  });
};
