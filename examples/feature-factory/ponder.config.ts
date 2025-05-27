import { parseAbiItem } from "abitype";
import { createConfig, factory } from "ponder";

import { LlamaCoreAbi } from "./abis/LlamaCoreAbi";
import { LlamaPolicyAbi } from "./abis/LlamaPolicyAbi";

const llamaFactoryEvent = parseAbiItem(
  "event LlamaInstanceCreated(address indexed deployer, string indexed name, address llamaCore, address llamaExecutor, address llamaPolicy, uint256 chainId)",
);

export default createConfig({
  chains: {
    sepolia: {
      id: 11155111,
      rpc: process.env.PONDER_RPC_URL_11155111,
    },
  },
  contracts: {
    LlamaCore: {
      chain: "sepolia",
      abi: LlamaCoreAbi,
      address: factory({
        address: "0xFf5d4E226D9A3496EECE31083a8F493edd79AbEB",
        event: llamaFactoryEvent,
        parameter: "llamaCore",
      }),
      startBlock: 4121269,
    },
    LlamaPolicy: {
      chain: "sepolia",
      abi: LlamaPolicyAbi,
      address: factory({
        address: "0xFf5d4E226D9A3496EECE31083a8F493edd79AbEB",
        event: llamaFactoryEvent,
        parameter: "llamaPolicy",
      }),
      startBlock: 4121269,
    },
  },
});
