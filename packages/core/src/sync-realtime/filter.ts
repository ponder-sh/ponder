import type { SyncLog } from "@/sync/index.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { type Address, type Hex, type LogTopic } from "viem";

export function filterLogs({
  logs,
  logFilters,
}: {
  logs: SyncLog[];
  logFilters: {
    address?: Address | Address[];
    topics?: LogTopic[];
  }[];
}) {
  return logs.filter((log) => {
    for (const { address, topics } of logFilters) {
      if (isLogMatchedByFilter({ log, address, topics })) return true;
    }
    return false;
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
  topics?: LogTopic[];
}) {
  const logAddress = toLowerCase(log.address);

  if (address !== undefined && address.length > 0) {
    if (Array.isArray(address)) {
      if (!address.includes(logAddress)) return false;
    } else {
      if (logAddress !== address) return false;
    }
  }

  if (topics) {
    for (const [index, topic] of topics.entries()) {
      if (topic === null || topic === undefined) continue;

      if (log.topics[index] === null || log.topics[index] === undefined)
        return false;

      if (Array.isArray(topic)) {
        if (!topic.includes(toLowerCase(log.topics[index]))) return false;
      } else {
        if (toLowerCase(log.topics[index]) !== topic) return false;
      }
    }
  }

  return true;
}
