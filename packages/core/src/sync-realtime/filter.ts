import { buildTraceFilterFragments } from "@/sync/fragments.js";
import { buildLogFilterFragments } from "@/sync/fragments.js";
import {
  type CallTraceFilter,
  type LogFactory,
  type LogFilter,
  isAddressFactory,
} from "@/sync/source.js";
import type { SyncBlock, SyncCallTrace, SyncLog } from "@/types/sync.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { hexToNumber } from "viem";

/**
 * Returns `true` if `log` matches `filter`
 */
export const isLogFactoryMatched = ({
  filter,
  log,
}: { filter: LogFactory; log: SyncLog }): boolean => {
  if (filter.address !== toLowerCase(log.address)) return false;
  if (log.topics.length === 0) return false;
  if (filter.eventSelector !== toLowerCase(log.topics[0]!)) return false;

  return true;
};

/**
 * Returns `true` if `log` matches `filter`
 */
export const isLogFilterMatched = ({
  filter,
  block,
  log,
}: {
  filter: LogFilter;
  block: SyncBlock;
  log: SyncLog;
}): boolean => {
  // Return `false` for out of range blocks
  if (
    hexToNumber(block.number) < filter.fromBlock ||
    hexToNumber(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  for (const {
    address,
    topic0,
    topic1,
    topic2,
    topic3,
  } of buildLogFilterFragments(filter)) {
    if (topic0 !== null && topic0 !== log.topics[0]?.toLowerCase())
      return false;
    if (topic1 !== null && topic1 !== log.topics[1]?.toLowerCase())
      return false;
    if (topic2 !== null && topic2 !== log.topics[2]?.toLowerCase())
      return false;
    if (topic3 !== null && topic3 !== log.topics[3]?.toLowerCase())
      return false;

    if (isAddressFactory(address)) continue;
    if (address !== null && address !== log.address.toLowerCase()) return false;
  }

  return true;
};

/**
 * Returns `true` if `callTrace` matches `filter`
 */
export const isCallTraceFilterMatched = ({
  filter,
  block,
  callTrace,
}: {
  filter: CallTraceFilter;
  block: SyncBlock;
  callTrace: SyncCallTrace;
}): boolean => {
  // Return `false` for out of range blocks
  if (
    hexToNumber(block.number) < filter.fromBlock ||
    hexToNumber(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  for (const { fromAddress, toAddress } of buildTraceFilterFragments(filter)) {
    if (
      fromAddress !== null &&
      fromAddress !== callTrace.action.from.toLowerCase()
    ) {
      return false;
    }

    if (isAddressFactory(toAddress)) continue;

    if (toAddress !== null && toAddress !== callTrace.action.to.toLowerCase()) {
      return false;
    }
  }

  return true;
};
