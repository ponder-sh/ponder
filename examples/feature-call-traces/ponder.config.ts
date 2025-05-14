import { createConfig } from "ponder";
import { multicall3Abi } from "viem";
import { mainnet } from "viem/chains";

export default createConfig({
  chains: {
    mainnet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1,
    },
  },
  contracts: {
    multicall3: {
      chain: "mainnet",
      abi: multicall3Abi,
      address: mainnet.contracts.multicall3.address,
      startBlock: 19_800_000,
      includeCallTraces: true,
    },
  },
});
