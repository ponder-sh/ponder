import { type Hex, keccak256 } from "viem";
import type { LogFilter } from "@/internal/types.js";
import {
  getFilterFromBlock,
  getFilterToBlock,
  isAddressFactory,
} from "@/runtime/filter.js";

export const zeroLogsBloom =
  "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

const BLOOM_SIZE_BYTES = 256;

/**
 * Byte offsets and bit masks of the three bloom bits for one input:
 * `[byte0, mask0, byte1, mask1, byte2, mask2]`.
 */
export type BloomBits = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * A `LogFilter` with each address and topic converted to `BloomBits`.
 *
 * `undefined` matches every bloom. An array matches if any item is in the bloom.
 */
export type LogFilterBloom = {
  fromBlock: number;
  toBlock: number;
  address: BloomBits[] | undefined;
  topics: (BloomBits[] | undefined)[];
  factory:
    | { address: BloomBits[] | undefined; eventSelector: BloomBits }
    | undefined;
};

export const getBloomBits = (input: Hex): BloomBits => {
  const hash = keccak256(input, "bytes");
  const bits: number[] = [];

  for (const i of [0, 2, 4]) {
    const bit = (hash[i + 1]! + (hash[i]! << 8)) & 0x7ff;
    bits.push(BLOOM_SIZE_BYTES - 1 - Math.floor(bit / 8), 1 << (bit % 8));
  }

  return bits as unknown as BloomBits;
};

export const isBloomBitsInBloom = (
  bloom: Uint8Array,
  bits: BloomBits,
): boolean =>
  (bloom[bits[0]]! & bits[1]) !== 0 &&
  (bloom[bits[2]]! & bits[3]) !== 0 &&
  (bloom[bits[4]]! & bits[5]) !== 0;

export const isInBloom = (bloom: Uint8Array, input: Hex): boolean =>
  isBloomBitsInBloom(bloom, getBloomBits(input));

const isAnyInBloom = (
  bloom: Uint8Array,
  bits: BloomBits[] | undefined,
): boolean =>
  bits === undefined || bits.some((b) => isBloomBitsInBloom(bloom, b));

const toBloomBits = (
  input: Hex | Hex[] | null | undefined,
): BloomBits[] | undefined => {
  if (input === null || input === undefined) return undefined;
  if (Array.isArray(input)) return input.map(getBloomBits);
  return [getBloomBits(input)];
};

/**
 * Convert `filter` to a `LogFilterBloom`. Call once for each filter,
 * so that the inputs are not hashed again for each block.
 */
export const getLogFilterBloom = (filter: LogFilter): LogFilterBloom => {
  let address: BloomBits[] | undefined;
  let factory: LogFilterBloom["factory"];

  if (isAddressFactory(filter.address)) {
    address = undefined;
    factory = {
      address: toBloomBits(filter.address.address),
      eventSelector: getBloomBits(filter.address.eventSelector),
    };
  } else if (Array.isArray(filter.address) && filter.address.length === 0) {
    address = undefined;
  } else {
    address = toBloomBits(filter.address);
  }

  return {
    fromBlock: getFilterFromBlock(filter),
    toBlock: getFilterToBlock(filter),
    address,
    topics: [filter.topic0, filter.topic1, filter.topic2, filter.topic3].map(
      toBloomBits,
    ),
    factory,
  };
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
  blockNumber,
  bloom,
  filter,
}: {
  blockNumber: number;
  bloom: Uint8Array;
  filter: LogFilterBloom;
}): boolean {
  // Return `false` for out of range blocks
  if (blockNumber < filter.fromBlock || blockNumber > filter.toBlock) {
    return false;
  }

  // Return true if the `Factory` is matched.
  if (
    filter.factory !== undefined &&
    isAnyInBloom(bloom, filter.factory.address) &&
    isBloomBitsInBloom(bloom, filter.factory.eventSelector)
  ) {
    return true;
  }

  return (
    isAnyInBloom(bloom, filter.address) &&
    filter.topics.every((topic) => isAnyInBloom(bloom, topic))
  );
}
