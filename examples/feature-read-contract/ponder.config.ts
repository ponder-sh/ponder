import { createConfig } from "@ponder/core";
import { http } from "viem";

import { mainnet } from "viem/chains";
import { FileStoreAbi } from "./abis/FileStoreAbi";

export default createConfig({
  networks: {
    mainnet: {
      chain: mainnet,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
  },
  contracts: {
    FileStore: {
      network: "mainnet",
      abi: FileStoreAbi,
      address: "0x9746fD0A77829E12F8A9DBe70D7a322412325B91",
      startBlock: 15963553,
    },
  },
});
