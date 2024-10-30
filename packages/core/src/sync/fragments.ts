import type { Address, Hex } from "viem";
import {
  type BlockFilter,
  type CallTraceFilter,
  type Filter,
  type LogFilter,
  isAddressFactory,
} from "./source.js";

export const getFragmentIds = (
  filter: Omit<Filter, "startBlock" | "endBlock">,
): FragmentReturnType => {
  if (filter.type === "log") {
    return getLogFilterFragmentIds(filter as LogFilter);
  }

  if (filter.type === "callTrace") {
    return getTraceFilterFragmentIds(filter as CallTraceFilter);
  }

  return getBlockFilterFragmentId(filter as BlockFilter);
};

type FragmentReturnType = {
  id: string;
  adjacent: string[];
}[];

/**
 * Generates log filter fragment IDs from a log filter.
 *
 * @param logFilter Log filter to be decomposed into fragments.
 * @returns A list of log filter fragment IDs.
 */
export const getLogFilterFragmentIds = ({
  chainId,
  address,
  topics,
  includeTransactionReceipts,
}: Omit<LogFilter, "fromBlock" | "toBlock">): FragmentReturnType => {
  const fragments: FragmentReturnType = [];
  const { topic0, topic1, topic2, topic3 } = parseTopics(topics);

  if (isAddressFactory(address)) {
    for (const address_ of Array.isArray(address.address)
      ? address.address
      : [address.address]) {
      for (const topic0_ of Array.isArray(topic0) ? topic0 : [topic0]) {
        for (const topic1_ of Array.isArray(topic1) ? topic1 : [topic1]) {
          for (const topic2_ of Array.isArray(topic2) ? topic2 : [topic2]) {
            for (const topic3_ of Array.isArray(topic3) ? topic3 : [topic3]) {
              const id = `${chainId}_${address_}_${address.eventSelector}_${address.childAddressLocation}_${topic0_}_${topic1_}_${topic2_}_${topic3_}_${
                includeTransactionReceipts ? 1 : 0
              }`;

              const adjacent = [id];

              if (topic0_ !== null) {
                adjacent.push(
                  `${chainId}_${address_}_${address.eventSelector}_${address.childAddressLocation}_${null}_${topic1_}_${topic2_}_${topic3_}_${
                    includeTransactionReceipts ? 1 : 0
                  }`,
                );
              }

              if (topic1_ !== null) {
                adjacent.push(
                  `${chainId}_${address_}_${address.eventSelector}_${address.childAddressLocation}_${topic0_}_${null}_${topic2_}_${topic3_}_${
                    includeTransactionReceipts ? 1 : 0
                  }`,
                );
              }

              if (topic2_ !== null) {
                adjacent.push(
                  `${chainId}_${address_}_${address.eventSelector}_${address.childAddressLocation}_${topic0_}_${topic1_}_${null}_${topic3_}_${
                    includeTransactionReceipts ? 1 : 0
                  }`,
                );
              }

              if (topic3_ !== null) {
                adjacent.push(
                  `${chainId}_${address_}_${address.eventSelector}_${address.childAddressLocation}_${topic0_}_${topic1_}_${topic2_}_${null}_${
                    includeTransactionReceipts ? 1 : 0
                  }`,
                );
              }

              if (includeTransactionReceipts === false) {
                adjacent.push(
                  `${chainId}_${address_}_${address.eventSelector}_${address.childAddressLocation}_${topic0_}_${topic1_}_${topic2_}_${topic3_}_${1}`,
                );
              }

              fragments.push({ id, adjacent });
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
              const id = `${chainId}_${address_}_${topic0_}_${topic1_}_${topic2_}_${topic3_}_${
                includeTransactionReceipts ? 1 : 0
              }`;

              const adjacent = [id];

              if (address_ !== null) {
                adjacent.push(
                  `${chainId}_${null}_${topic0_}_${topic1_}_${topic2_}_${topic3_}_${
                    includeTransactionReceipts ? 1 : 0
                  }`,
                );
              }

              if (topic0_ !== null) {
                adjacent.push(
                  `${chainId}_${address_}_${null}_${topic1_}_${topic2_}_${topic3_}_${
                    includeTransactionReceipts ? 1 : 0
                  }`,
                );
              }

              if (topic1_ !== null) {
                adjacent.push(
                  `${chainId}_${address_}_${topic0_}_${null}_${topic2_}_${topic3_}_${
                    includeTransactionReceipts ? 1 : 0
                  }`,
                );
              }

              if (topic2_ !== null) {
                adjacent.push(
                  `${chainId}_${address_}_${topic0_}_${topic1_}_${null}_${topic3_}_${
                    includeTransactionReceipts ? 1 : 0
                  }`,
                );
              }

              if (topic3_ !== null) {
                adjacent.push(
                  `${chainId}_${address_}_${topic0_}_${topic1_}_${topic2_}_${null}_${
                    includeTransactionReceipts ? 1 : 0
                  }`,
                );
              }

              if (includeTransactionReceipts === false) {
                adjacent.push(
                  `${chainId}_${address_}_${topic0_}_${topic1_}_${topic2_}_${topic3_}_${1}`,
                );
              }

              fragments.push({ id, adjacent });
            }
          }
        }
      }
    }
  }

  return fragments;
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

export const getBlockFilterFragmentId = ({
  chainId,
  interval,
  offset,
}: Omit<BlockFilter, "fromBlock" | "toBlock">): FragmentReturnType => {
  return [
    {
      id: `${chainId}_${interval}_${offset}`,
      adjacent: [`${chainId}_${interval}_${offset}`],
    },
  ];
};

export const getTraceFilterFragmentIds = ({
  chainId,
  fromAddress,
  toAddress,
}: Omit<CallTraceFilter, "fromBlock" | "toBlock"> & {
  chainId: number;
}): FragmentReturnType => {
  const fragments: FragmentReturnType = [];

  if (isAddressFactory(toAddress)) {
    for (const _fromAddress of fromAddress === undefined
      ? [null]
      : fromAddress) {
      for (const _toAddress of Array.isArray(toAddress.address)
        ? toAddress.address
        : [toAddress.address]) {
        const id = `${chainId}_${_toAddress}_${toAddress.eventSelector}_${toAddress.childAddressLocation}_${_fromAddress}`;

        const adjacent = [id];

        if (_fromAddress !== null) {
          adjacent.push(
            `${chainId}_${_toAddress}_${toAddress.eventSelector}_${toAddress.childAddressLocation}_${null}`,
          );
        }

        fragments.push({ id, adjacent });
      }
    }
  } else {
    for (const _fromAddress of fromAddress === undefined
      ? [null]
      : fromAddress) {
      for (const _toAddress of toAddress === undefined
        ? [null]
        : (toAddress as Address[])) {
        const id = `${chainId}_${_fromAddress}_${_toAddress}`;

        const adjacent = [id];

        if (_toAddress !== null) {
          adjacent.push(`${chainId}_${null}_${_fromAddress}`);
        }

        if (_fromAddress !== null) {
          adjacent.push(`${chainId}_${_toAddress}_${null}`);
        }

        fragments.push({ id, adjacent });
      }
    }
  }

  return fragments;
};
