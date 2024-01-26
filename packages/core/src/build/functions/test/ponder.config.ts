import { http, parseAbi, zeroAddress } from "viem";
import { createConfig } from "../../../config/config.js";

const abi = parseAbi([
  "event Event1(bytes32 arg)",
  "event Event2(bytes32 arg)",
  "event Event3(bytes32 arg)",
]);

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
