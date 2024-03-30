import { createConfig } from "@ponder/core";
import { http } from "viem";
import { mainnet } from "viem/chains";
import { ExampleContractAbi } from "./abis/ExampleContractAbi";

export default createConfig({
  networks: {
    mainnet: {
      chain: mainnet,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
  },
  contracts: {
    ExampleContract: {
      network: "mainnet",
      abi: ExampleContractAbi,
      address: "0x0",
      startBlock: 1234567,
    },
  },
});
