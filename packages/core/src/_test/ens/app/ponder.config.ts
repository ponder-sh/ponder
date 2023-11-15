import { http } from "viem";

import { createConfig } from "../../../../dist";
import { BaseRegistrarImplementationAbi } from "./BaseRegistrarImplementation.abi";

const poolId = Number(process.env.VITEST_POOL_ID ?? 1);
const transport = http(`http://127.0.0.1:8545/${poolId}`);

export default createConfig({
  networks: { mainnet: { chainId: 1, transport } },
  contracts: {
    BaseRegistrarImplementation: {
      network: "mainnet",
      abi: BaseRegistrarImplementationAbi,
      address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
      startBlock: 16370000,
      endBlock: 16370020,
      maxBlockRange: 10,
    },
  },
});
