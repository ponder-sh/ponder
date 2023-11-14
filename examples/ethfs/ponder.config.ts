import { createConfig } from "@ponder/core";
import { http } from "viem";

import { FileStoreAbi } from "./abis/FileStore.abi";

export default createConfig({
  networks: [
    {
      name: "mainnet",
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
  ],
  contracts: [
    {
      name: "FileStore",
      network: [{ name: "mainnet" }],
      abi: FileStoreAbi,
      address: "0x9746fD0A77829E12F8A9DBe70D7a322412325B91",
      startBlock: 15963553,
    },
  ],
});
