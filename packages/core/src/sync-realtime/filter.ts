import type {
  CallTraceFilterCriteria,
  LogFilterCriteria,
} from "@/config/sources.js";
import type { SyncCallTrace, SyncLog } from "@/sync/index.js";
import { toLowerCase } from "@/utils/lowercase.js";

export function filterLogs({
  logs,
  logFilters,
}: {
  logs: SyncLog[];
  logFilters: Pick<LogFilterCriteria, "address" | "topics">[];
}) {
  return logs.filter((log) =>
    logFilters.some((logFilter) => isLogMatchedByFilter({ log, logFilter })),
  );
}

export function isLogMatchedByFilter({
  log,
  logFilter,
}: {
  log: Pick<SyncLog, "address" | "topics">;
  logFilter: Pick<LogFilterCriteria, "address" | "topics">;
}) {
  const logAddress = toLowerCase(log.address);

  if (logFilter.address !== undefined && logFilter.address.length > 0) {
    if (Array.isArray(logFilter.address)) {
      if (!logFilter.address.includes(logAddress)) return false;
    } else {
      if (logAddress !== logFilter.address) return false;
    }
  }

  if (logFilter.topics) {
    for (const [index, topic] of logFilter.topics.entries()) {
      if (topic === null || topic === undefined) continue;

      if (log.topics[index] === null || log.topics[index] === undefined)
        return false;

      if (Array.isArray(topic)) {
        if (!topic.includes(toLowerCase(log.topics[index]!))) return false;
      } else {
        if (toLowerCase(log.topics[index]!) !== topic) return false;
      }
    }
  }

  return true;
}

export function filterCallTraces({
  callTraces,
  callTraceFilters,
}: {
  callTraces: SyncCallTrace[];
  callTraceFilters: Pick<
    CallTraceFilterCriteria,
    "fromAddress" | "toAddress"
  >[];
}) {
  return callTraces.filter((callTrace) =>
    callTraceFilters.some((callTraceFilter) =>
      isCallTraceMatchedByFilter({ callTrace, callTraceFilter }),
    ),
  );
}

export function isCallTraceMatchedByFilter({
  callTrace,
  callTraceFilter,
}: {
  callTrace: Pick<SyncCallTrace, "action">;
  callTraceFilter: Pick<CallTraceFilterCriteria, "fromAddress" | "toAddress">;
}) {
  const fromAddress = toLowerCase(callTrace.action.from);
  const toAddress = toLowerCase(callTrace.action.to);

  if (
    callTraceFilter.fromAddress !== undefined &&
    callTraceFilter.fromAddress.length > 0
  ) {
    if (!callTraceFilter.fromAddress.includes(fromAddress)) return false;
  }

  if (
    callTraceFilter.toAddress !== undefined &&
    callTraceFilter.toAddress.length > 0
  ) {
    if (!callTraceFilter.toAddress.includes(toAddress)) return false;
  }

  return true;
}
