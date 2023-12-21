import { http, getAbiItem } from "viem";

import { createConfig } from "../../../config/config.js";
import { CONTRACTS } from "../../constants.js";
import { factoryABI, pairABI } from "../../generated.js";

const poolId = Number(process.env.VITEST_POOL_ID ?? 1);

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(`http://127.0.0.1:8545/${poolId}`),
    },
  },
  contracts: {
    Pair: {
      network: "mainnet",
      abi: pairABI,
      factory: {
        address: CONTRACTS.factoryAddress,
        event: getAbiItem({ abi: factoryABI, name: "PairCreated" }),
        parameter: "pair",
      },
    },
  },
});
