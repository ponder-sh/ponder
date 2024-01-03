import { createConfig } from "@ponder/core";
import { erc20ABI } from "@wagmi/core";
import { http } from "viem";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http("https://rpc.ankr.com/eth", { retryCount: 4 }),
    },
  },
  contracts: {
    ERC20: {
      network: "mainnet",
      abi: erc20ABI,
      address: "0x32353A6C91143bfd6C7d363B546e62a9A2489A20",
      startBlock: 13142655,
      endBlock: 13150000,
    },
  },
});
