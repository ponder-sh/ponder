import type { PonderConfig } from "@ponder/core";
import { graphqlPlugin } from "@ponder/graphql";

export const config: PonderConfig = {
  networks: [
    {
      name: "mainnet",
      chainId: 1,
      rpcUrl: process.env.PONDER_RPC_URL_1,
    },
  ],
  contracts: [
    {
      name: "FileStore",
      network: "mainnet",
      abi: "./abis/FileStore.json",
      address: "0x9746fD0A77829E12F8A9DBe70D7a322412325B91",
      startBlock: 15963553,
      endBlock: 16000000,
    },
    {
      name: "FileStoreFrontend",
      network: "mainnet",
      address: "0xBc66C61BCF49Cc3fe4E321aeCEa307F61EC57C0b",
      abi: "./abis/FileStoreFrontend.json",
      isIndexed: false,
    },
  ],
  plugins: [graphqlPlugin()],
};
