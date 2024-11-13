import {
  type BlockFilter,
  type CallTraceFilter,
  type LogFactory,
  type LogFilter,
  isAddressFactory,
} from "@/sync/source.js";
import type { SyncBlock, SyncCallTrace, SyncLog } from "@/types/sync.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { type Address, hexToNumber } from "viem";

const isValueMatched = <T extends string>(
  filterValue: T | T[] | null | undefined,
  eventValue: T | undefined,
): boolean => {
  // match all
  if (filterValue === null || filterValue === undefined) return true;

  // missing value
  if (eventValue === undefined) return false;

  // array
  if (
    Array.isArray(filterValue) &&
    filterValue.some((v) => v === toLowerCase(eventValue))
  ) {
    return true;
  }

  // single
  if (filterValue === toLowerCase(eventValue)) return true;

  return false;
};

/**
 * Returns `true` if `log` matches `filter`
 */
export const isLogFactoryMatched = ({
  filter,
  log,
}: { filter: LogFactory; log: SyncLog }): boolean => {
  const addresses = Array.isArray(filter.address)
    ? filter.address
    : [filter.address];

  if (addresses.every((address) => address !== toLowerCase(log.address))) {
    return false;
  }
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

  if (isValueMatched(filter.topics[0], log.topics[0]) === false) return false;
  if (isValueMatched(filter.topics[1], log.topics[1]) === false) return false;
  if (isValueMatched(filter.topics[2], log.topics[2]) === false) return false;
  if (isValueMatched(filter.topics[3], log.topics[3]) === false) return false;
  if (
    isAddressFactory(filter.address) === false &&
    isValueMatched(
      filter.address as Address | Address[] | undefined,
      log.address,
    ) === false
  ) {
    return false;
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

  if (isValueMatched(filter.fromAddress, callTrace.action.from) === false) {
    return false;
  }

  if (
    isAddressFactory(filter.toAddress) === false &&
    isValueMatched(
      filter.toAddress as Address | Address[] | undefined,
      callTrace.action.to,
    ) === false
  ) {
    return false;
  }

  return true;
};

/**
 * Returns `true` if `block` matches `filter`
 */
export const isBlockFilterMatched = ({
  filter,
  block,
}: {
  filter: BlockFilter;
  block: SyncBlock;
}): boolean => {
  // Return `false` for out of range blocks
  if (
    hexToNumber(block.number) < filter.fromBlock ||
    hexToNumber(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  return (hexToNumber(block.number) - filter.offset) % filter.interval === 0;
};
