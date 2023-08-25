import { startProxy } from "@viem/anvil";
import dotenv from "dotenv";

import { FORK_BLOCK_NUMBER } from "./constants";

export default async function () {
  dotenv.config({ path: ".env.local" });

  if (!process.env.ANVIL_FORK_URL) {
    throw new Error('Missing environment variable "ANVIL_FORK_URL"');
  }

  return await startProxy({
    options: {
      chainId: 1,
      forkUrl: process.env.ANVIL_FORK_URL,
      forkBlockNumber: FORK_BLOCK_NUMBER,
    },
  });
}
