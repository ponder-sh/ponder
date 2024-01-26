import { http, zeroAddress } from "viem";
import { createConfig } from "../../../config/config.js";
import { abi } from "./abi.js";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(),
    },
  },
  contracts: {
    C: {
      network: "mainnet",
      abi,
      address: zeroAddress,
    },
  },
});
