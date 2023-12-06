import { useQuery } from "@tanstack/react-query";
import { GraphQLClient } from "graphql-request";
import { type Address, getAddress } from "viem";

import { BalanceQueryDocument } from "@/graphql/generated/graphql";

const client = new GraphQLClient("http://localhost:42069");

export const useWethBalance = (address: Address | undefined) => {
  return useQuery({
    queryKey: ["weth balance", address],
    queryFn: async () => {
      const r = await client.request(BalanceQueryDocument, {
        address: getAddress(address!),
      });
      return r.account?.balance ? BigInt(r.account.balance) : undefined;
    },
    enabled: !!address,
  });
};
