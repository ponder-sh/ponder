import { type LogFilter, isAddressFactory } from "@/sync/source.js";
import type { SyncBlock } from "@/types/sync.js";
import { type Hex, hexToBytes, hexToNumber, keccak256 } from "viem";

export const zeroLogsBloom =
  "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

const BLOOM_SIZE_BYTES = 256;

export const isInBloom = (_bloom: Hex, input: Hex): boolean => {
  const bloom = hexToBytes(_bloom);
  const hash = hexToBytes(keccak256(input));

  for (const i of [0, 2, 4]) {
    const bit = (hash[i + 1]! + (hash[i]! << 8)) & 0x7ff;
    if (
      (bloom[BLOOM_SIZE_BYTES - 1 - Math.floor(bit / 8)]! &
        (1 << (bit % 8))) ===
      0
    )
      return false;
  }

  return true;
};

/**
 * Return true if `filter` is in `bloom`.
 *
 * A filter with an address of type `LogFactory` is matched
 * if the address filter is matched (new child contract) or the log
 * filter is matched (log on child contract).
 *
 * Note: False positives are possible.
 */
export function isFilterInBloom({
  block,
  filter,
}: {
  block: Pick<SyncBlock, "number" | "logsBloom">;
  filter: LogFilter;
}): boolean {
  // Return `false` for out of range blocks
  if (
    hexToNumber(block.number) < filter.fromBlock ||
    hexToNumber(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  let isTopicsInBloom: boolean;
  let isAddressInBloom: boolean;

  if (filter.topics === undefined || filter.topics.length === 0) {
    isTopicsInBloom = true;
  } else {
    isTopicsInBloom = filter.topics.some((topic) => {
      if (topic === null || topic === undefined) {
        return true;
      } else if (Array.isArray(topic)) {
        return topic.some((t) => isInBloom(block.logsBloom, t));
      } else {
        return isInBloom(block.logsBloom, topic);
      }
    });
  }

  if (filter.address === undefined) isAddressInBloom = true;
  else if (isAddressFactory(filter.address)) {
    // Return true if the `Factory` is matched.
    if (
      (Array.isArray(filter.address.address)
        ? filter.address.address.some((address) =>
            isInBloom(block.logsBloom, address),
          )
        : isInBloom(block.logsBloom, filter.address.address)) &&
      isInBloom(block.logsBloom, filter.address.eventSelector)
    ) {
      return true;
    }

    isAddressInBloom = true;
  } else if (Array.isArray(filter.address)) {
    if (filter.address.length === 0) {
      isAddressInBloom = true;
    } else {
      isAddressInBloom = filter.address.some((address) =>
        isInBloom(block.logsBloom, address),
      );
    }
  } else {
    // single address case
    isAddressInBloom = isInBloom(block.logsBloom, filter.address);
  }

  return isAddressInBloom && isTopicsInBloom;
}
