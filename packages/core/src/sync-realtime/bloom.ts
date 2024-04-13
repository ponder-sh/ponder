import {
  isContractAddressInBloom,
  isTopicInBloom,
} from "ethereum-bloom-filters";
import type { Address, Hex, LogTopic } from "viem";

export const zeroLogsBloom =
  "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

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
  if (allAddresses.some((a) => isContractAddressInBloom(bloom, a))) {
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
  if (allTopics.some((a) => isTopicInBloom(bloom, a))) {
    return true;
  }

  return false;
}
