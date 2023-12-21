import { useQuery } from "@tanstack/react-query";
import { GraphQLClient, gql } from "graphql-request";

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
      const r = (await client.request(gql`
        {
          depositEvents(
            orderDirection: "desc"
            orderBy: "timestamp"
            first: 10
          ) {
            id
            timestamp
            account
            amount
          }
        }
      `)) as {
        depositEvents: {
          id: string;
          timestamp: number;
          account: string;
          amount: number;
        }[];
      };
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
