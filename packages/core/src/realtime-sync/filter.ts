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
      // If the log filter has specified an `address` field, check if the log matches it.
      if (address) {
        if (Array.isArray(address)) {
          if (!address.includes(log.address)) return false;
        } else {
          if (log.address !== address) return false;
        }
      }

      // If the log filter has specified a `topics` field, check if the log matches it.
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
    }

    return true;
  });
}
