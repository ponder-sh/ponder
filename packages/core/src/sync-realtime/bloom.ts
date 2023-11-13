import {
  isContractAddressInBloom,
  isTopicInBloom,
} from "ethereum-bloom-filters";
import type { Address, Hex } from "viem";

import type { Topics } from "@/config/sources.js";

export function isMatchedLogInBloomFilter({
  bloom,
  logFilters,
}: {
  bloom: Hex;
  logFilters: {
    address?: Address | Address[];
    topics?: Topics;
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
