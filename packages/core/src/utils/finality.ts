import { hexToNumber, numberToHex } from "viem";
import type { Chain, LightBlock } from "@/internal/types.js";
import { eth_getBlockByNumber } from "@/rpc/actions.js";
import type { Rpc } from "@/rpc/index.js";

export const DEFAULT_MAX_REORG_SECONDS = 60;

export const isAsyncExecutionChain = (chainId: number) =>
  chainId === 143 || chainId === 10143;

/**
 * Finds a block whose timestamp is outside the reorg window.
 * Block timestamps are monotonic, so a binary search avoids retaining or
 * fetching one block per second on fast chains. The returned block can be up
 * to 20% older than the target timestamp, which is safe and avoids extra RPC
 * requests when the block time estimate is slightly inaccurate.
 */
export async function getFinalizedBlock({
  chain,
  rpc,
  latestBlock,
  lowerBound,
}: {
  chain: Chain;
  rpc: Rpc;
  latestBlock: LightBlock;
  lowerBound?: LightBlock;
}): Promise<LightBlock> {
  const { maxReorgSeconds } = chain;
  if (maxReorgSeconds === 0) return latestBlock;

  const targetTimestamp = hexToNumber(latestBlock.timestamp) - maxReorgSeconds;

  let low = lowerBound ? hexToNumber(lowerBound.number) : 0;
  let high = hexToNumber(latestBlock.number);
  let finalizedBlock: LightBlock | undefined;

  const blockTimeSeconds =
    chain.viemChain?.blockTime === undefined || chain.viemChain.blockTime <= 0
      ? 1
      : chain.viemChain.blockTime / 1_000;
  const estimatedBlockCount = Math.ceil(maxReorgSeconds / blockTimeSeconds);
  const estimatedBlockNumber = high - estimatedBlockCount;
  let blockNumber = Math.max(low, Math.min(estimatedBlockNumber, high));
  const timestampTolerance = maxReorgSeconds / 5;

  while (low <= high) {
    const block = await eth_getBlockByNumber(
      rpc,
      [numberToHex(blockNumber), false],
      { retryNullBlockRequest: true },
    );

    if (hexToNumber(block.timestamp) <= targetTimestamp) {
      finalizedBlock = block;

      if (targetTimestamp - hexToNumber(block.timestamp) < timestampTolerance) {
        return block;
      }

      low = blockNumber + 1;
    } else {
      high = blockNumber - 1;
    }

    if (low > high) break;
    blockNumber = Math.floor((low + high) / 2);
  }

  if (finalizedBlock === undefined) {
    throw new Error("Unable to find a finalized block");
  }

  return finalizedBlock;
}
