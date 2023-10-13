import { http } from "viem";

import BaseRegistrarImplementationAbi from "./BaseRegistrarImplementation.abi.json";

export const config = {
  networks: [
    { name: "mainnet", chainId: 1, transport: http("http://127.0.0.1:8545") },
  ],
  contracts: [
    {
      name: "BaseRegistrarImplementation",
      network: "mainnet",
      abi: BaseRegistrarImplementationAbi,
      address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
      startBlock: 16370000,
      endBlock: 16370020,
      maxBlockRange: 10,
    },
  ],
};
