import {
  type Address,
  type Hex,
  type LogTopic,
  hexToBytes,
  keccak256,
} from "viem";

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

export function isMatchedLogInBloomFilter({
  bloom,
  logFilters,
}: {
  bloom: Hex;
  logFilters: {
    address?: Address | Address[];
    topics?: LogTopic[];
  }[];
}) {
  const allAddresses: Address[] = [];
  logFilters.forEach((logFilter) => {
    const address =
      logFilter.address === undefined
        ? []
        : Array.isArray(logFilter.address)
          ? logFilter.address
          : [logFilter.address];
    allAddresses.push(...address);
  });
  if (allAddresses.some((a) => isInBloom(bloom, a))) {
    return true;
  }

  const allTopics: Hex[] = [];
  logFilters.forEach((logFilter) => {
    logFilter.topics?.forEach((topic) => {
      if (topic === null) return;
      if (Array.isArray(topic)) allTopics.push(...topic);
      else allTopics.push(topic);
    });
  });
  if (allTopics.some((a) => isInBloom(bloom, a))) {
    return true;
  }

  return false;
}
