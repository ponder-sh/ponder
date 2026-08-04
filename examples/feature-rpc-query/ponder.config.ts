import { createConfig } from "ponder";
import { parseAbi } from "viem";

export default createConfig({
  chains: {
    monad: {
      id: 143,
      rpc: process.env.PONDER_RPC_URL_143,
      experimental_rpcQuery: true,
    },
  },
  contracts: {
    USDC: {
      chain: "monad",
      abi: parseAbi([
        "event Transfer(address indexed from, address indexed to, uint256 amount)",
      ]),
      address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
      startBlock: 93_270_922,
      includeCallTraces: true,
    },
  },
  accounts: {
    USDCMinter: {
      chain: "monad",
      address: "0xfd78ee919681417d192449715b2594ab58f5d002",
      startBlock: 93_270_922,
    },
  },
});
