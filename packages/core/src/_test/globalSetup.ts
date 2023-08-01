import { startProxy } from "@viem/anvil";

import { FORK_BLOCK_NUMBER, FORK_URL } from "./constants";

export default async function () {
  return await startProxy({
    port: 8545,
    host: "::",
    options: {
      chainId: 1,
      forkUrl: FORK_URL,
      forkBlockNumber: FORK_BLOCK_NUMBER,
    },
  });
}
