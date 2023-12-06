import { createConfig } from "@ponder/core";
import { erc20ABI } from "@wagmi/core";
import { http } from "viem";

export default createConfig({
  networks: {
    goerli: {
      chainId: 5,
      transport: http(process.env.PONDER_RPC_URL_5),
      maxRpcRequestConcurrency: 10,
    },
  },
  contracts: {
    ERC20: {
      network: "goerli",
      abi: erc20ABI,
      address: "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6",
      startBlock: 1036651,
    },
  },
});
