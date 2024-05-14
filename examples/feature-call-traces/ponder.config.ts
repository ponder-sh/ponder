import { createConfig } from "@ponder/core";
import { http, Abi, multicall3Abi } from "viem";
import { mainnet } from "viem/chains";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
  },
  contracts: {
    multicall3: {
      network: "mainnet",
      abi: multicall3Abi,
      address: mainnet.contracts.multicall3.address,
      startBlock: 19_800_000,
      includeCallTraces: true,
      maxBlockRange: 25,
    },
  },
});
