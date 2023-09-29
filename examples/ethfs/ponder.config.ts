import type { Config } from "@ponder/core";
import { http } from "viem";

import FileStoreAbi from "./abis/FileStore.json";
import FileStoreFrontendAbi from "./abis/FileStoreFrontend.json";

export const config: Config = {
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
      network: "mainnet",
      abi: FileStoreAbi,
      address: "0x9746fD0A77829E12F8A9DBe70D7a322412325B91",
      startBlock: 15963553,
    },
    {
      name: "FileStoreFrontend",
      network: "mainnet",
      address: "0xBc66C61BCF49Cc3fe4E321aeCEa307F61EC57C0b",
      abi: FileStoreFrontendAbi,
      isLogEventSource: false,
    },
  ],
};
