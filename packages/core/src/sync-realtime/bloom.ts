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

export type BloomBits = {
  byte0: number;
  mask0: number;
  byte1: number;
  mask1: number;
  byte2: number;
  mask2: number;
};

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
  const bytes = [0, 0, 0];
  const masks = [0, 0, 0];

  for (let i = 0; i < 3; i++) {
    const bit = (hash[i * 2 + 1]! + (hash[i * 2]! << 8)) & 0x7ff;
    bytes[i] = BLOOM_SIZE_BYTES - 1 - Math.floor(bit / 8);
    masks[i] = 1 << (bit % 8);
  }

  return {
    byte0: bytes[0]!,
    mask0: masks[0]!,
    byte1: bytes[1]!,
    mask1: masks[1]!,
    byte2: bytes[2]!,
    mask2: masks[2]!,
  };
};

export const isBloomBitsInBloom = (
  bloom: Uint8Array,
  bits: BloomBits,
): boolean =>
  (bloom[bits.byte0]! & bits.mask0) !== 0 &&
  (bloom[bits.byte1]! & bits.mask1) !== 0 &&
  (bloom[bits.byte2]! & bits.mask2) !== 0;

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
