import type { PonderSyncSchema } from "@/sync-store/encoding.js";
import type { Address, Hex } from "viem";
import {
  type BlockFilter,
  type Factory,
  type LogFactory,
  type LogFilter,
  type TransactionFilter,
  type TransferFilter,
  isAddressFactory,
} from "./source.js";

export type LogFilterFragment<
  factory extends Factory | undefined = Factory | undefined,
> = factory extends Factory
  ? PonderSyncSchema["factoryLogFilters"]
  : PonderSyncSchema["logFilters"];

export type BlockFilterFragment = PonderSyncSchema["blockFilters"];

export type TransactionFilterFragment<
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = fromFactory extends Factory
  ? PonderSyncSchema["factoryTransactionFilters"]
  : toFactory extends Factory
    ? PonderSyncSchema["factoryTransactionFilters"]
    : PonderSyncSchema["transactionFilters"];

export type TransferFilterFragment<
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = fromFactory extends Factory
  ? PonderSyncSchema["factoryTransferFilters"]
  : toFactory extends Factory
    ? PonderSyncSchema["factoryTransferFilters"]
    : PonderSyncSchema["transferFilters"];

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

export const buildTransactionFilterFragments = <
  fromFactory extends Factory | undefined,
  toFactory extends Factory | undefined,
>({
  chainId,
  fromAddress,
  toAddress,
  callType,
  functionSelectors,
  includeInner,
  includeFailed,
}: Omit<
  TransactionFilter<fromFactory, toFactory>,
  "fromBlock" | "toBlock"
>): TransactionFilterFragment<fromFactory, toFactory>[] => {
  const fragments: TransactionFilterFragment[] = [];

  const idCallback = ({
    chainId,
    fromAddress,
    toAddress,
    callType,
    functionSelector,
    includeInner,
    includeFailed,
  }: Omit<TransactionFilterFragment, "id">) => {
    return `${chainId}_${fromAddress}_${toAddress}_${callType}_${functionSelector}_${includeInner}_${includeFailed}`;
  };

  const factoryIdCallback = ({
    chainId,
    fromAddress,
    fromEventSelector,
    fromChildAddressLocation,
    toAddress,
    toEventSelector,
    toChildAddressLocation,
    callType,
    functionSelector,
    includeInner,
    includeFailed,
  }: Omit<TransactionFilterFragment, "id"> & {
    fromEventSelector: LogFactory["eventSelector"] | null;
    fromChildAddressLocation: LogFactory["childAddressLocation"] | null;
    toEventSelector: LogFactory["eventSelector"] | null;
    toChildAddressLocation: LogFactory["childAddressLocation"] | null;
  }) => {
    return `${chainId}_${fromAddress}_${fromEventSelector}_${fromChildAddressLocation}_${toAddress}_${toEventSelector}_${toChildAddressLocation}_${callType}_${functionSelector}_${includeInner}_${includeFailed}`;
  };

  if (isAddressFactory(fromAddress) || isAddressFactory(toAddress)) {
    for (const _fromAddress of isAddressFactory(fromAddress)
      ? Array.isArray(fromAddress.address)
        ? fromAddress.address
        : [fromAddress.address]
      : Array.isArray(fromAddress)
        ? fromAddress
        : [fromAddress ?? null]) {
      for (const _toAddress of isAddressFactory(toAddress)
        ? Array.isArray(toAddress.address)
          ? toAddress.address
          : [toAddress.address]
        : Array.isArray(toAddress)
          ? toAddress
          : [toAddress ?? null]) {
        for (const _callType of Array.isArray(callType)
          ? callType
          : [callType]) {
          for (const _functionSelector of Array.isArray(functionSelectors)
            ? functionSelectors
            : [functionSelectors]) {
            fragments.push({
              id: factoryIdCallback({
                chainId,
                fromAddress: _fromAddress,
                fromEventSelector: isAddressFactory(fromAddress)
                  ? fromAddress.eventSelector
                  : null,
                fromChildAddressLocation: isAddressFactory(fromAddress)
                  ? fromAddress.childAddressLocation
                  : null,
                toAddress: _toAddress,
                toEventSelector: isAddressFactory(toAddress)
                  ? toAddress.eventSelector
                  : null,
                toChildAddressLocation: isAddressFactory(toAddress)
                  ? toAddress.childAddressLocation
                  : null,
                callType: _callType ?? null,
                functionSelector: _functionSelector ?? null,
                includeInner: includeInner ? 1 : 0,
                includeFailed: includeFailed ? 1 : 0,
              }),
              chainId,
              fromAddress: _fromAddress,
              fromEventSelector: isAddressFactory(fromAddress)
                ? fromAddress.eventSelector
                : null,
              fromChildAddressLocation: isAddressFactory(fromAddress)
                ? fromAddress.childAddressLocation
                : null,
              toAddress: _toAddress,
              toEventSelector: isAddressFactory(toAddress)
                ? toAddress.eventSelector
                : null,
              toChildAddressLocation: isAddressFactory(toAddress)
                ? toAddress.childAddressLocation
                : null,
              callType: _callType ?? null,
              functionSelector: _functionSelector ?? null,
              includeInner: includeInner ? 1 : 0,
              includeFailed: includeFailed ? 1 : 0,
            });
          }
        }
      }
    }
  } else {
    for (const _fromAddress of Array.isArray(fromAddress)
      ? fromAddress
      : [fromAddress ?? null]) {
      for (const _toAddress of Array.isArray(toAddress)
        ? toAddress
        : [toAddress ?? null]) {
        for (const _callType of Array.isArray(callType)
          ? callType
          : [callType]) {
          for (const _functionSelector of Array.isArray(functionSelectors)
            ? functionSelectors
            : [functionSelectors]) {
            fragments.push({
              id: idCallback({
                chainId,
                fromAddress: _fromAddress,
                toAddress: _toAddress,
                callType: _callType ?? null,
                functionSelector: _functionSelector ?? null,
                includeInner: includeInner ? 1 : 0,
                includeFailed: includeFailed ? 1 : 0,
              }),
              chainId,
              fromAddress: _fromAddress,
              toAddress: _toAddress,
              callType: _callType ?? null,
              functionSelector: _functionSelector ?? null,
              includeInner: includeInner ? 1 : 0,
              includeFailed: includeFailed ? 1 : 0,
            });
          }
        }
      }
    }
  }

  return fragments as TransactionFilterFragment<fromFactory, toFactory>[];
};

export const buildTransferFilterFragments = <
  fromFactory extends Factory | undefined,
  toFactory extends Factory | undefined,
>({
  chainId,
  fromAddress,
  toAddress,
}: Omit<
  TransferFilter<fromFactory, toFactory>,
  "fromBlock" | "toBlock"
>): TransferFilterFragment<fromFactory, toFactory>[] => {
  const fragments: TransferFilterFragment[] = [];

  const idCallback = ({
    chainId,
    fromAddress,
    toAddress,
  }: Omit<TransferFilterFragment, "id">) => {
    return `${chainId}_${fromAddress}_${toAddress}`;
  };

  const factoryIdCallback = ({
    chainId,
    fromAddress,
    fromEventSelector,
    fromChildAddressLocation,
    toAddress,
    toEventSelector,
    toChildAddressLocation,
  }: Omit<TransferFilterFragment, "id"> & {
    fromEventSelector: LogFactory["eventSelector"] | null;
    fromChildAddressLocation: LogFactory["childAddressLocation"] | null;
    toEventSelector: LogFactory["eventSelector"] | null;
    toChildAddressLocation: LogFactory["childAddressLocation"] | null;
  }) => {
    return `${chainId}_${fromAddress}_${fromEventSelector}_${fromChildAddressLocation}_${toAddress}_${toEventSelector}_${toChildAddressLocation}`;
  };

  if (isAddressFactory(fromAddress) || isAddressFactory(toAddress)) {
    for (const _fromAddress of isAddressFactory(fromAddress)
      ? Array.isArray(fromAddress.address)
        ? fromAddress.address
        : [fromAddress.address]
      : Array.isArray(fromAddress)
        ? fromAddress
        : [fromAddress ?? null]) {
      for (const _toAddress of isAddressFactory(toAddress)
        ? Array.isArray(toAddress.address)
          ? toAddress.address
          : [toAddress.address]
        : Array.isArray(toAddress)
          ? toAddress
          : [toAddress ?? null]) {
        fragments.push({
          id: factoryIdCallback({
            chainId,
            fromAddress: _fromAddress,
            fromEventSelector: isAddressFactory(fromAddress)
              ? fromAddress.eventSelector
              : null,
            fromChildAddressLocation: isAddressFactory(fromAddress)
              ? fromAddress.childAddressLocation
              : null,
            toAddress: _toAddress,
            toEventSelector: isAddressFactory(toAddress)
              ? toAddress.eventSelector
              : null,
            toChildAddressLocation: isAddressFactory(toAddress)
              ? toAddress.childAddressLocation
              : null,
          }),
          chainId,
          fromAddress: _fromAddress,
          fromEventSelector: isAddressFactory(fromAddress)
            ? fromAddress.eventSelector
            : null,
          fromChildAddressLocation: isAddressFactory(fromAddress)
            ? fromAddress.childAddressLocation
            : null,
          toAddress: _toAddress,
          toEventSelector: isAddressFactory(toAddress)
            ? toAddress.eventSelector
            : null,
          toChildAddressLocation: isAddressFactory(toAddress)
            ? toAddress.childAddressLocation
            : null,
        });
      }
    }
  } else {
    for (const _fromAddress of Array.isArray(fromAddress)
      ? fromAddress
      : [fromAddress ?? null]) {
      for (const _toAddress of Array.isArray(toAddress)
        ? toAddress
        : [toAddress ?? null]) {
        fragments.push({
          id: idCallback({
            chainId,
            fromAddress: _fromAddress,
            toAddress: _toAddress,
          }),
          chainId,
          fromAddress: _fromAddress,
          toAddress: _toAddress,
        });
      }
    }
  }

  return fragments as TransferFilterFragment<fromFactory, toFactory>[];
};
