import { useQuery } from "@tanstack/react-query";
import { GraphQLClient } from "graphql-request";

import { DepositsQueryDocument } from "../graphql/generated/graphql";

const client = new GraphQLClient("http://localhost:42069");

export type Deposit = {
  id: string;
  account: string;
  timestamp: number;
  amount: bigint;
};

export const useDeposits = () => {
  return useQuery<Deposit[]>({
    queryKey: ["weth deposits"],
    queryFn: async () => {
      // Use generated graphql request
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
