import type { Config } from "@ponder/core";
import { parseAbiItem } from "abitype";

import LlamaCoreAbi from "./abis/LlamaCore.json";
import LlamaFactoryAbi from "./abis/LlamaFactory.json";

export const config: Config = {
  networks: [
    {
      name: "sepolia",
      chainId: 11155111,
      rpcUrl: process.env.PONDER_RPC_URL_11155111,
    },
  ],
  factories: [
    {
      name: "LlamaFactory",
      network: "sepolia",
      address: "0xFf5d4E226D9A3496EECE31083a8F493edd79AbEB",
      startBlock: 4121269,
      abi: LlamaFactoryAbi,
      factoryEvent: parseAbiItem(
        "event LlamaInstanceCreated(address indexed deployer, string indexed name, address llamaCore, address llamaExecutor, address llamaPolicy, uint256 chainId)"
      ),
      factoryEventAddressArgument: "llamaCore",
      child: {
        name: "LlamaCore",
        abi: LlamaCoreAbi,
      },
    },
  ],
};
