import type { PonderSyncSchema } from "@/sync-store/encoding.js";
import type { Address, Hex } from "viem";
import {
  type BlockFilter,
  type CallTraceFilter,
  type Factory,
  type LogFactory,
  type LogFilter,
  isAddressFactory,
} from "./source.js";

export type LogFilterFragment<
  factory extends Factory | undefined = Factory | undefined,
> = factory extends Factory
  ? PonderSyncSchema["factoryLogFilters"]
  : PonderSyncSchema["logFilters"];

export type BlockFilterFragment = PonderSyncSchema["blockFilters"];

export type TraceFilterFragment<
  factory extends Factory | undefined = Factory | undefined,
> = factory extends Factory
  ? PonderSyncSchema["factoryTraceFilters"]
  : PonderSyncSchema["traceFilters"];

/**
 * Generates log filter fragments from a log filter.
 *
 * @param logFilter Log filter to be decomposed into fragments.
 * @returns A list of log filter fragments.
 */
export const buildLogFilterFragments = <factory extends Factory | undefined>({
  chainId,
  address,
  topics,
  includeTransactionReceipts,
}: Omit<
  LogFilter<factory>,
  "fromBlock" | "toBlock"
>): LogFilterFragment<factory>[] => {
  const fragments: LogFilterFragment[] = [];
  const { topic0, topic1, topic2, topic3 } = parseTopics(topics);

  const idCallback = ({
    chainId,
    address: address_,
    topic0: topic0_,
    topic1: topic1_,
    topic2: topic2_,
    topic3: topic3_,
    includeTransactionReceipts,
  }: Omit<LogFilterFragment, "id" | "address"> & {
    address: Address | null;
  }) => {
    return `${chainId}_${address_}_${topic0_}_${topic1_}_${topic2_}_${topic3_}_${
      includeTransactionReceipts
    }`;
  };

  const factoryIdCallback = ({
    chainId,
    address: address_,
    eventSelector: eventSelector_,
    childAddressLocation: childAddressLocation_,
    topic0: topic0_,
    topic1: topic1_,
    topic2: topic2_,
    topic3: topic3_,
    includeTransactionReceipts,
  }: Omit<LogFilterFragment, "id" | "address"> & {
    address: Address;
    eventSelector: LogFactory["eventSelector"];
    childAddressLocation: LogFactory["childAddressLocation"];
  }) => {
    return `${chainId}_${address_}_${eventSelector_}_${childAddressLocation_}_${topic0_}_${topic1_}_${topic2_}_${topic3_}_${
      includeTransactionReceipts
    }`;
  };

  if (isAddressFactory(address)) {
    for (const factoryAddress_ of Array.isArray(address.address)
      ? address.address
      : [address.address]) {
      for (const topic0_ of Array.isArray(topic0) ? topic0 : [topic0]) {
        for (const topic1_ of Array.isArray(topic1) ? topic1 : [topic1]) {
          for (const topic2_ of Array.isArray(topic2) ? topic2 : [topic2]) {
            for (const topic3_ of Array.isArray(topic3) ? topic3 : [topic3]) {
              fragments.push({
                id: factoryIdCallback({
                  chainId,
                  address: factoryAddress_,
                  eventSelector: address.eventSelector,
                  childAddressLocation: address.childAddressLocation,
                  topic0: topic0_,
                  topic1: topic1_,
                  topic2: topic2_,
                  topic3: topic3_,
                  includeTransactionReceipts: includeTransactionReceipts
                    ? 1
                    : 0,
                }),
                chainId,
                address: factoryAddress_,
                eventSelector: address.eventSelector,
                childAddressLocation: address.childAddressLocation,
                topic0: topic0_,
                topic1: topic1_,
                topic2: topic2_,
                topic3: topic3_,
                includeTransactionReceipts: includeTransactionReceipts ? 1 : 0,
              });
            }
          }
        }
      }
    }
  } else {
    for (const address_ of Array.isArray(address)
      ? address
      : [address ?? null]) {
      for (const topic0_ of Array.isArray(topic0) ? topic0 : [topic0]) {
        for (const topic1_ of Array.isArray(topic1) ? topic1 : [topic1]) {
          for (const topic2_ of Array.isArray(topic2) ? topic2 : [topic2]) {
            for (const topic3_ of Array.isArray(topic3) ? topic3 : [topic3]) {
              fragments.push({
                id: idCallback({
                  chainId,
                  address: address_,
                  topic0: topic0_,
                  topic1: topic1_,
                  topic2: topic2_,
                  topic3: topic3_,
                  includeTransactionReceipts: includeTransactionReceipts
                    ? 1
                    : 0,
                }),
                chainId,
                address: address_,
                topic0: topic0_,
                topic1: topic1_,
                topic2: topic2_,
                topic3: topic3_,
                includeTransactionReceipts: includeTransactionReceipts ? 1 : 0,
              });
            }
          }
        }
      }
    }
  }

  return fragments as LogFilterFragment<factory>[];
};

function parseTopics(topics: (Hex | Hex[] | null)[] | undefined) {
  return {
    topic0: topics?.[0] ?? null,
    topic1: topics?.[1] ?? null,
    topic2: topics?.[2] ?? null,
    topic3: topics?.[3] ?? null,
  } as {
    topic0: Hex | Hex[] | null;
    topic1: Hex | Hex[] | null;
    topic2: Hex | Hex[] | null;
    topic3: Hex | Hex[] | null;
  };
}

export const buildBlockFilterFragment = ({
  chainId,
  interval,
  offset,
}: Omit<BlockFilter, "fromBlock" | "toBlock">): BlockFilterFragment => {
  return {
    id: `${chainId}_${interval}_${offset}`,
    chainId,
    interval,
    offset,
  };
};

export const buildTraceFilterFragments = <factory extends Factory | undefined>({
  chainId,
  fromAddress,
  toAddress,
}: Omit<CallTraceFilter<factory>, "fromBlock" | "toBlock"> & {
  chainId: number;
}): TraceFilterFragment<factory>[] => {
  const fragments: TraceFilterFragment[] = [];

  const idCallback = ({
    chainId,
    fromAddress,
    toAddress,
  }: Omit<TraceFilterFragment, "id" | "toAddress"> & {
    toAddress: Address | null;
  }) => {
    return `${chainId}_${fromAddress}_${toAddress}`;
  };

  const factoryIdCallback = ({
    chainId,
    fromAddress,
    address,
    eventSelector,
    childAddressLocation,
  }: Omit<TraceFilterFragment, "id" | "toAddress"> & {
    address: Address;
    eventSelector: LogFactory["eventSelector"];
    childAddressLocation: LogFactory["childAddressLocation"];
  }) => {
    return `${chainId}_${address}_${eventSelector}_${childAddressLocation}_${fromAddress}`;
  };

  if (isAddressFactory(toAddress)) {
    for (const _fromAddress of Array.isArray(fromAddress)
      ? fromAddress
      : [null]) {
      for (const _factoryAddress of Array.isArray(toAddress.address)
        ? toAddress.address
        : [toAddress.address]) {
        fragments.push({
          id: factoryIdCallback({
            chainId,
            fromAddress: _fromAddress,
            address: _factoryAddress,
            eventSelector: toAddress.eventSelector,
            childAddressLocation: toAddress.childAddressLocation,
          }),
          chainId,
          address: _factoryAddress,
          eventSelector: toAddress.eventSelector,
          childAddressLocation: toAddress.childAddressLocation,
          fromAddress: _fromAddress,
        });
      }
    }
  } else {
    for (const _fromAddress of Array.isArray(fromAddress)
      ? fromAddress
      : [null]) {
      for (const _toAddress of Array.isArray(toAddress) ? toAddress : [null]) {
        fragments.push({
          id: idCallback({
            chainId,
            fromAddress: _fromAddress,
            toAddress: _toAddress,
          }),
          chainId,
          toAddress: _toAddress,
          fromAddress: _fromAddress,
        });
      }
    }
  }

  return fragments as TraceFilterFragment<factory>[];
};
