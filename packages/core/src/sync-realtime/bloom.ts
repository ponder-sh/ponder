import { type LogFilter, isAddressFilter } from "@/sync/source.js";
import { type Hex, hexToBytes, keccak256 } from "viem";

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
 * A filter with an address of type `LogAddressFilter` is matched
 * if the address filter is matched (new child contract) or the log
 * filter is matched (log on child contract).
 *
 * Note: False positives are possible.
 * TODO(kyle) consider block number
 */
export function isFilterInBloom({
  bloom,
  filter,
}: { bloom: Hex; filter: LogFilter }): boolean {
  let isTopicsInBloom: boolean;
  let isAddressInBloom: boolean;

  if (filter.topics === undefined || filter.topics.length === 0) {
    isTopicsInBloom = true;
  } else {
    isTopicsInBloom = filter.topics.some((topic) => {
      if (topic === null || topic === undefined) {
        return true;
      } else if (Array.isArray(topic)) {
        return topic.some((t) => isInBloom(bloom, t));
      } else {
        return isInBloom(bloom, topic);
      }
    });
  }

  if (filter.address === undefined) isAddressInBloom = true;
  else if (isAddressFilter(filter.address)) {
    // Return true if the `LogAddressFilter` is matched.

    let _isAddressInBloom: boolean;
    if (Array.isArray(filter.address.address)) {
      if (filter.address.address.length === 0) {
        _isAddressInBloom = true;
      } else {
        _isAddressInBloom = filter.address.address.some((address) =>
          isInBloom(bloom, address),
        );
      }
    } else {
      _isAddressInBloom = isInBloom(bloom, filter.address.address);
    }

    if (_isAddressInBloom && isInBloom(bloom, filter.address.eventSelector)) {
      return true;
    }

    isAddressInBloom = true;
  } else if (Array.isArray(filter.address)) {
    if (filter.address.length === 0) {
      isAddressInBloom = true;
    } else {
      isAddressInBloom = filter.address.some((address) =>
        isInBloom(bloom, address),
      );
    }
  } else {
    // single address case
    isAddressInBloom = isInBloom(bloom, filter.address);
  }

  return isAddressInBloom && isTopicsInBloom;
}
