import { parseAbiItem } from "abitype";
import { createConfig, factory } from "ponder";
import { http } from "viem";

import { ChildContractAbi } from "./abis/ChildContractAbi";
import { LlamaCoreAbi } from "./abis/LlamaCoreAbi";
import { LlamaPolicyAbi } from "./abis/LlamaPolicyAbi";

const llamaFactoryEvent = parseAbiItem(
  "event LlamaInstanceCreated(address indexed deployer, string indexed name, address llamaCore, address llamaExecutor, address llamaPolicy, uint256 chainId)",
);

const FactoryEvent = parseAbiItem([
  "event ChildCreated(address indexed creator, ChildInfo child, uint256 indexed timestamp)",
  "struct ChildInfo { address childAddress; string name; uint256 initialValue; uint256 creationTime; address creator; }",
]);

export default createConfig({
  networks: {
    sepolia: {
      chainId: 11155111,
      transport: http(process.env.PONDER_RPC_URL_11155111),
    },
  },
  contracts: {
    LlamaCore: {
      network: "sepolia",
      abi: LlamaCoreAbi,
      address: factory({
        address: "0xFf5d4E226D9A3496EECE31083a8F493edd79AbEB",
        event: llamaFactoryEvent,
        parameter: "llamaCore",
      }),
      startBlock: 4121269,
    },
    LlamaPolicy: {
      network: "sepolia",
      abi: LlamaPolicyAbi,
      address: factory({
        address: "0xFf5d4E226D9A3496EECE31083a8F493edd79AbEB",
        event: llamaFactoryEvent,
        parameter: "llamaPolicy",
      }),
      startBlock: 4121269,
    },
    ChildContract: {
      network: "sepolia",
      abi: ChildContractAbi,
      address: factory({
        address: "0x021626321f74956da6d64605780D738A569F24DD",
        event: FactoryEvent,
        parameter: "child.childAddress",
      }),
      startBlock: 7262700,
    },
  },
});
