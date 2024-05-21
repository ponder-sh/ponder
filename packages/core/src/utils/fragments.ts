import type {
  CallTraceFilterCriteria,
  ChildAddressCriteria,
  FactoryCallTraceFilterCriteria,
  FactoryLogFilterCriteria,
  LogFilterCriteria,
} from "@/config/sources.js";
import type { Address, Hex } from "viem";

/**
 * Generates log filter fragments from a log filter.
 *
 * @param logFilter Log filter to be decompose into fragments.
 * @returns A list of log filter fragments.
 */
export function buildLogFilterFragments({
  address,
  topics,
  includeTransactionReceipts,
  chainId,
}: LogFilterCriteria & {
  chainId: number;
}) {
  return buildLogFragments({
    address,
    topics,
    includeTransactionReceipts,
    chainId,
    idCallback: (address_, topic0_, topic1_, topic2_, topic3_) =>
      `${chainId}_${address_}_${topic0_}_${topic1_}_${topic2_}_${topic3_}_${
        includeTransactionReceipts ? 1 : 0
      }`,
  });
}

/**
 * Generates factory fragments from a factory.
 *
 * @param factory Factory to be decomposed into fragments.
 * @returns A list of factory fragments.
 */
export function buildFactoryLogFragments({
  address,
  eventSelector,
  childAddressLocation,
  topics,
  includeTransactionReceipts,
  chainId,
}: FactoryLogFilterCriteria & {
  chainId: number;
}) {
  const fragments = buildLogFragments({
    address,
    topics,
    includeTransactionReceipts,
    chainId,
    childAddressLocation,
    eventSelector,
    idCallback: (address_, topic0_, topic1_, topic2_, topic3_) =>
      `${chainId}_${address_}_${eventSelector}_${childAddressLocation}_${topic0_}_${topic1_}_${topic2_}_${topic3_}_${
        includeTransactionReceipts ? 1 : 0
      }`,
  });

  return fragments as ((typeof fragments)[number] & ChildAddressCriteria)[];
}

function buildLogFragments({
  address,
  topics,
  chainId,
  idCallback,
  includeTransactionReceipts,
  ...rest
}: (LogFilterCriteria | FactoryLogFilterCriteria) & {
  idCallback: (
    address: Address | null,
    topic0: ReturnType<typeof parseTopics>["topic0"],
    topic1: ReturnType<typeof parseTopics>["topic1"],
    topic2: ReturnType<typeof parseTopics>["topic2"],
    topic3: ReturnType<typeof parseTopics>["topic3"],
  ) => string;
  chainId: number;
}) {
  const fragments: {
    id: string;
    chainId: number;
    address: Hex | null;
    topic0: Hex | null;
    topic1: Hex | null;
    topic2: Hex | null;
    topic3: Hex | null;
    includeTransactionReceipts: 0 | 1;
  }[] = [];

  const { topic0, topic1, topic2, topic3 } = parseTopics(topics);

  for (const address_ of Array.isArray(address) ? address : [address ?? null]) {
    for (const topic0_ of Array.isArray(topic0) ? topic0 : [topic0]) {
      for (const topic1_ of Array.isArray(topic1) ? topic1 : [topic1]) {
        for (const topic2_ of Array.isArray(topic2) ? topic2 : [topic2]) {
          for (const topic3_ of Array.isArray(topic3) ? topic3 : [topic3]) {
            fragments.push({
              id: idCallback(address_, topic0_, topic1_, topic2_, topic3_),
              ...rest,
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

  return fragments;
}

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

export function buildTraceFragments({
  fromAddress,
  toAddress,
  chainId,
}: CallTraceFilterCriteria & {
  chainId: number;
}) {
  const fragments: {
    id: string;
    chainId: number;
    fromAddress: Hex | null;
    toAddress: Hex | null;
  }[] = [];

  for (const _fromAddress of Array.isArray(fromAddress)
    ? fromAddress
    : [null]) {
    for (const _toAddress of Array.isArray(toAddress) ? toAddress : [null]) {
      fragments.push({
        id: `${chainId}_${_fromAddress}_${_toAddress}`,
        chainId,
        fromAddress: _fromAddress,
        toAddress: _toAddress,
      });
    }
  }

  return fragments;
}

export function buildFactoryTraceFragments({
  address,
  eventSelector,
  childAddressLocation,
  fromAddress,
  chainId,
}: FactoryCallTraceFilterCriteria & {
  chainId: number;
}) {
  const fragments: ({
    id: string;
    chainId: number;
    fromAddress: Hex | null;
  } & ChildAddressCriteria)[] = [];

  for (const _fromAddress of Array.isArray(fromAddress)
    ? fromAddress
    : [null]) {
    fragments.push({
      id: `${chainId}_${address}_${eventSelector}_${childAddressLocation}_${_fromAddress}`,
      chainId,
      address,
      eventSelector,
      childAddressLocation,
      fromAddress: _fromAddress,
    });
  }

  return fragments;
}
