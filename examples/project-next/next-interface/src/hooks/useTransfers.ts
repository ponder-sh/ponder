import { useQuery } from "@tanstack/react-query";
import { GraphQLClient } from "graphql-request";

import { TransfersQueryDocument } from "@/graphql/generated/graphql";

const client = new GraphQLClient("http://localhost:42069");

export const useTransfers = () => {
  return useQuery({
    queryKey: ["weth transfers"],
    queryFn: async () => {
      const r = await client.request(TransfersQueryDocument);
      return r.transferEvents.map((t) => ({
        from: t!.from!.id,
        to: t!.to!.id,
        timestamp: t!.timestamp!,
        amount: BigInt(t!.amount),
      }));
    },
    staleTime: Infinity,
    refetchInterval: 1_000,
  });
};
