/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore
import { graphqlPlugin } from "@ponder/graphql";

import EmptyAbi from "./Empty.abi.json";

export const config = {
  networks: [{ name: "mainnet", chainId: 1, rpcUrl: "rpc://url" }],
  contracts: [
    {
      name: "Contract",
      network: "mainnet",
      abi: EmptyAbi,
      address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
      startBlock: 10,
    },
  ],
  plugins: [graphqlPlugin()],
};
