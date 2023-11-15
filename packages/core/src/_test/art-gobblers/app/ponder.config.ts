import { http } from "viem";

import { createConfig } from "../../../../dist";
import { ArtGobblersAbi } from "./ArtGobblers.abi";

const poolId = Number(process.env.VITEST_POOL_ID ?? 1);
const transport = http(`http://127.0.0.1:8545/${poolId}`);

export default createConfig({
  networks: { mainnet: { chainId: 1, transport } },
  contracts: {
    ArtGobblers: {
      network: "mainnet",
      abi: ArtGobblersAbi,
      address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
      startBlock: 15870400,
      endBlock: 15870405, // 5 blocks
    },
  },
});
