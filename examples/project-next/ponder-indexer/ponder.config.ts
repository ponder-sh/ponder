import { createConfig } from "@ponder/core";
import { erc20ABI } from "@wagmi/core";
import { http } from "viem";

export default createConfig({
  networks: {
    sepolia: {
      chainId: 11155111,
      transport: http(process.env.PONDER_RPC_URL_11155111),
    },
  },
  contracts: {
    WETH: {
      network: "sepolia",
      abi: erc20ABI,
      address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
      filter: { event: "Transfer" },
      startBlock: 4835000,
    },
  },
});
