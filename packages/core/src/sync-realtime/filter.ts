import { buildLogFilterFragments } from "@/sync/fragments.js";
import {
  type BlockFilter,
  type LogFactory,
  type LogFilter,
  type TransactionFilter,
  type TransferFilter,
  isAddressFactory,
} from "@/sync/source.js";
import type { SyncBlock, SyncLog, SyncTrace } from "@/types/sync.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { type Address, hexToBigInt, hexToNumber } from "viem";

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

  return buildLogFilterFragments(filter).some((fragment) => {
    if (
      fragment.topic0 !== null &&
      fragment.topic0 !== log.topics[0]?.toLowerCase()
    )
      return false;
    if (
      fragment.topic1 !== null &&
      fragment.topic1 !== log.topics[1]?.toLowerCase()
    )
      return false;
    if (
      fragment.topic2 !== null &&
      fragment.topic2 !== log.topics[2]?.toLowerCase()
    )
      return false;
    if (
      fragment.topic3 !== null &&
      fragment.topic3 !== log.topics[3]?.toLowerCase()
    )
      return false;

    if (
      isAddressFactory(filter.address) === false &&
      fragment.address !== null &&
      fragment.address !== log.address.toLowerCase()
    )
      return false;

    return true;
  });
};

/**
 * Returns `true` if `trace` matches `filter`
 */
export const isTransactionFilterMatched = ({
  filter,
  block,
  trace,
}: {
  filter: TransactionFilter;
  block: Pick<SyncBlock, "number">;
  trace: Omit<SyncTrace["result"], "calls" | "logs">;
}): boolean => {
  // Return `false` for out of range blocks
  if (
    hexToNumber(block.number) < filter.fromBlock ||
    hexToNumber(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  if (
    isValueMatched(filter.functionSelectors, trace.input.slice(0, 10)) === false
  ) {
    return false;
  }
  if (
    isAddressFactory(filter.fromAddress) === false &&
    isValueMatched(
      filter.fromAddress as Address | Address[] | undefined,
      trace.from,
    ) === false
  ) {
    return false;
  }
  if (
    isAddressFactory(filter.toAddress) === false &&
    isValueMatched(
      filter.toAddress as Address | Address[] | undefined,
      trace.to,
    ) === false
  ) {
    return false;
  }

  // TODO(kyle) include inner
  // TODO(kyle) include failed
  // TODO(kyle) call type

  return true;
};

/**
 * Returns `true` if `trace` matches `filter`
 */
export const isTransferFilterMatched = ({
  filter,
  block,
  trace,
}: {
  filter: TransferFilter;
  block: Pick<SyncBlock, "number">;
  trace: Omit<SyncTrace["result"], "calls" | "logs">;
}): boolean => {
  // Return `false` for out of range blocks
  if (
    hexToNumber(block.number) < filter.fromBlock ||
    hexToNumber(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  if (hexToBigInt(trace.value) === 0n) return false;
  if (
    isAddressFactory(filter.fromAddress) === false &&
    isValueMatched(
      filter.fromAddress as Address | Address[] | undefined,
      trace.from,
    ) === false
  ) {
    return false;
  }
  if (
    isAddressFactory(filter.toAddress) === false &&
    isValueMatched(
      filter.toAddress as Address | Address[] | undefined,
      trace.to,
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
