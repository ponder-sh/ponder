import type { Chain } from "viem";

/**
 * Returns the number of blocks that must pass before a block is considered final.
 * Note that a value of `0` indicates that blocks are considered final immediately.
 *
 * @param chain The chain to get the finality block count for.
 * @returns The finality block count.
 */
export function getFinalityBlockCount({ chain }: { chain: Chain | undefined }) {
  let finalityBlockCount: number;
  switch (chain?.id) {
    // Mainnet and mainnet testnets.
    case 1:
    case 3:
    case 4:
    case 5:
    case 42:
    case 11155111:
      finalityBlockCount = 65;
      break;
    // Polygon.
    case 137:
    case 80001:
      finalityBlockCount = 200;
      break;
    // Arbitrum.
    case 42161:
    case 42170:
    case 421611:
    case 421613:
      finalityBlockCount = 240;
      break;
    default:
      // Assume a 2-second block time, e.g. OP stack chains.
      finalityBlockCount = 30;
  }

  return finalityBlockCount;
}
