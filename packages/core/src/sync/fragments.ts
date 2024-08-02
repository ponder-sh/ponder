import type { Hex, LogTopic } from "viem";
import {
  type AddressFilter,
  type BlockFilter,
  type LogFilter,
  isAddressFilter,
} from "./source.js";

export type LogFilterFragment = {
  id: string;
  chainId: number;
  address: Hex | AddressFilter | null;
  topic0: Hex | null;
  topic1: Hex | null;
  topic2: Hex | null;
  topic3: Hex | null;
  includeTransactionReceipts: 0 | 1;
};

export type BlockFilterFragment = {
  id: string;
  chainId: number;
  interval: number;
  offset: number;
};

/**
 * Generates log filter fragments from a log filter.
 *
 * @param logFilter Log filter to be decomposed into fragments.
 * @returns A list of log filter fragments.
 */
export const buildLogFilterFragments = ({
  chainId,
  address,
  topics,
  includeTransactionReceipts,
}: Omit<LogFilter, "fromBlock" | "toBlock">) => {
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
  }: Omit<LogFilterFragment, "id">) => {
    if (isAddressFilter(address_)) {
      return `${chainId}_${address_.address}_${address_.eventSelector}_${address_.childAddressLocation}_${topic0_}_${topic1_}_${topic2_}_${topic3_}_${
        includeTransactionReceipts
      }`;
    }

    return `${chainId}_${address_}_${topic0_}_${topic1_}_${topic2_}_${topic3_}_${
      includeTransactionReceipts
    }`;
  };

  for (const address_ of Array.isArray(address) ? address : [address ?? null]) {
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
                includeTransactionReceipts: includeTransactionReceipts ? 1 : 0,
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

  return fragments;
};

const parseTopics = (topics: LogTopic[] | undefined) => {
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
};

export const buildBlockFilterFragment = ({
  chainId,
  interval,
  offset,
}: BlockFilter): BlockFilterFragment => {
  return {
    id: `${chainId}_${interval}_${offset}`,
    chainId,
    interval,
    offset,
  };
};

// export function buildTraceFragments({
//   fromAddress,
//   toAddress,
//   chainId,
// }: CallTraceFilterCriteria & {
//   chainId: number;
// }) {
//   const fragments: {
//     id: string;
//     chainId: number;
//     fromAddress: Hex | null;
//     toAddress: Hex | null;
//   }[] = [];

//   for (const _fromAddress of Array.isArray(fromAddress)
//     ? fromAddress
//     : [null]) {
//     for (const _toAddress of Array.isArray(toAddress) ? toAddress : [null]) {
//       fragments.push({
//         id: `${chainId}_${_fromAddress}_${_toAddress}`,
//         chainId,
//         fromAddress: _fromAddress,
//         toAddress: _toAddress,
//       });
//     }
//   }

//   return fragments;
// }

// export function buildFactoryTraceFragments({
//   address,
//   eventSelector,
//   childAddressLocation,
//   fromAddress,
//   chainId,
// }: FactoryCallTraceFilterCriteria & {
//   chainId: number;
// }) {
//   const fragments: ({
//     id: string;
//     chainId: number;
//     fromAddress: Hex | null;
//   } & ChildAddressCriteria)[] = [];

//   for (const _fromAddress of Array.isArray(fromAddress)
//     ? fromAddress
//     : [null]) {
//     fragments.push({
//       id: `${chainId}_${address}_${eventSelector}_${childAddressLocation}_${_fromAddress}`,
//       chainId,
//       address,
//       eventSelector,
//       childAddressLocation,
//       fromAddress: _fromAddress,
//     });
//   }

//   return fragments;
// }
