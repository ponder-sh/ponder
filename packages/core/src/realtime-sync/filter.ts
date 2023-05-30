import { Address, Hex, RpcLog } from "viem";

export function filterLogs({
  logs,
  logFilters,
}: {
  logs: RpcLog[];
  logFilters: {
    address?: Address | Address[];
    topics?: (Hex | Hex[] | null)[];
  }[];
}) {
  return logs.filter((log) => {
    for (const { address, topics } of logFilters) {
      if (!isLogMatchedByFilter({ log, address, topics })) return false;
    }
    return true;
  });
}

export function isLogMatchedByFilter({
  log,
  address,
  topics,
}: {
  log: {
    address: Address;
    topics: Hex[];
  };
  address?: Address | Address[];
  topics?: (Hex | Hex[] | null)[];
}) {
  if (address) {
    if (Array.isArray(address)) {
      if (!address.includes(log.address)) return false;
    } else {
      if (log.address !== address) return false;
    }
  }

  if (topics) {
    for (const [index, topic] of topics.entries()) {
      if (topic === null) continue;
      if (Array.isArray(topic)) {
        if (!topic.includes(log.topics[index])) return false;
      } else {
        if (log.topics[index] !== topic) return false;
      }
    }
  }

  return true;
}
