import type { Address, Hex } from "viem";
import {
  type BlockFilter,
  type CallTraceFilter,
  type Factory,
  type Filter,
  type LogFilter,
  isAddressFactory,
} from "./source.js";

type FragmentAddress =
  | Address
  | `${Address}_${Factory["eventSelector"]}_${Factory["childAddressLocation"]}`
  | null;
type FragmentTopic = Hex | null;

export type FragmentId =
  | `log_${number}_${FragmentAddress}_${FragmentTopic}_${FragmentTopic}_${FragmentTopic}_${FragmentTopic}_${0 | 1}`
  | `trace_${number}_${FragmentAddress}_${Address | null}`
  | `block_${number}_${number}_${number}`;

export const getFragmentIds = (
  filter: Filter extends Filter
    ? Omit<Filter, "startBlock" | "endBlock">
    : never,
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
  id: FragmentId;
  adjacent: FragmentId[];
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
    for (const fragmentAddress of Array.isArray(address.address)
      ? address.address
      : [address.address]) {
      for (const fragmentTopic0 of Array.isArray(topic0) ? topic0 : [topic0]) {
        for (const fragmentTopic1 of Array.isArray(topic1)
          ? topic1
          : [topic1]) {
          for (const fragmentTopic2 of Array.isArray(topic2)
            ? topic2
            : [topic2]) {
            for (const fragmentTopic3 of Array.isArray(topic3)
              ? topic3
              : [topic3]) {
              const id =
                `log_${chainId}_${fragmentAddress}_${address.eventSelector}_${address.childAddressLocation}_${fragmentTopic0}_${fragmentTopic1}_${fragmentTopic2}_${fragmentTopic3}_${
                  includeTransactionReceipts ? 1 : 0
                }` as const;

              const adjacent: FragmentId[] = [];

              for (const adjacentTopic0 of fragmentTopic0 === null
                ? [fragmentTopic0]
                : [fragmentTopic0, null]) {
                for (const adjacentTopic1 of fragmentTopic1 === null
                  ? [fragmentTopic1]
                  : [fragmentTopic1, null]) {
                  for (const adjacentTopic2 of fragmentTopic2 === null
                    ? [fragmentTopic2]
                    : [fragmentTopic3, null]) {
                    for (const adjacentTopic3 of fragmentTopic3 === null
                      ? [fragmentTopic3]
                      : [fragmentTopic3, null]) {
                      for (const adjacentTxr of includeTransactionReceipts ===
                      true
                        ? [1]
                        : [0, 1]) {
                        adjacent.push(
                          `log_${chainId}_${fragmentAddress}_${address.eventSelector}_${address.childAddressLocation}_${adjacentTopic0}_${adjacentTopic1}_${adjacentTopic2}_${adjacentTopic3}_${
                            adjacentTxr as 0 | 1
                          }`,
                        );
                      }
                    }
                  }
                }
              }

              fragments.push({ id, adjacent });
            }
          }
        }
      }
    }
  } else {
    for (const fragmentAddress of Array.isArray(address)
      ? address
      : [address ?? null]) {
      for (const fragmentTopic0 of Array.isArray(topic0) ? topic0 : [topic0]) {
        for (const fragmentTopic1 of Array.isArray(topic1)
          ? topic1
          : [topic1]) {
          for (const fragmentTopic2 of Array.isArray(topic2)
            ? topic2
            : [topic2]) {
            for (const fragmentTopic3 of Array.isArray(topic3)
              ? topic3
              : [topic3]) {
              const id =
                `log_${chainId}_${fragmentAddress}_${fragmentTopic0}_${fragmentTopic1}_${fragmentTopic2}_${fragmentTopic3}_${
                  includeTransactionReceipts ? 1 : 0
                }` as const;

              const adjacent: FragmentId[] = [];

              for (const adjacentAddress of fragmentAddress === null
                ? [fragmentAddress]
                : [fragmentAddress, null]) {
                for (const adjacentTopic0 of fragmentTopic0 === null
                  ? [fragmentTopic0]
                  : [fragmentTopic0, null]) {
                  for (const adjacentTopic1 of fragmentTopic1 === null
                    ? [fragmentTopic1]
                    : [fragmentTopic1, null]) {
                    for (const adjacentTopic2 of fragmentTopic2 === null
                      ? [fragmentTopic2]
                      : [fragmentTopic3, null]) {
                      for (const adjacentTopic3 of fragmentTopic3 === null
                        ? [fragmentTopic3]
                        : [fragmentTopic3, null]) {
                        for (const adjacentTxr of includeTransactionReceipts ===
                        true
                          ? [1]
                          : [0, 1]) {
                          adjacent.push(
                            `log_${chainId}_${adjacentAddress}_${adjacentTopic0}_${adjacentTopic1}_${adjacentTopic2}_${adjacentTopic3}_${
                              adjacentTxr as 0 | 1
                            }`,
                          );
                        }
                      }
                    }
                  }
                }
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
      id: `block_${chainId}_${interval}_${offset}`,
      adjacent: [`block_${chainId}_${interval}_${offset}`],
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
    for (const fragmentFromAddress of fromAddress === undefined
      ? [null]
      : fromAddress) {
      for (const fragmentToAddress of Array.isArray(toAddress.address)
        ? toAddress.address
        : [toAddress.address]) {
        const id =
          `trace_${chainId}_${fragmentToAddress}_${toAddress.eventSelector}_${toAddress.childAddressLocation}_${fragmentFromAddress}` as const;

        const adjacent: FragmentId[] = [];

        for (const adjacentFromAddress of fragmentFromAddress === null
          ? [fragmentFromAddress]
          : [fragmentFromAddress, null]) {
          adjacent.push(
            `trace_${chainId}_${fragmentToAddress}_${toAddress.eventSelector}_${toAddress.childAddressLocation}_${adjacentFromAddress}`,
          );
        }

        fragments.push({ id, adjacent });
      }
    }
  } else {
    for (const fragmentFromAddress of fromAddress === undefined
      ? [null]
      : fromAddress) {
      for (const fragmentToAddress of toAddress === undefined
        ? [null]
        : (toAddress as Address[])) {
        const id =
          `trace_${chainId}_${fragmentFromAddress}_${fragmentToAddress}` as const;

        const adjacent: FragmentId[] = [];

        for (const adjacentFromAddress of fragmentFromAddress === null
          ? [fragmentFromAddress]
          : [fragmentFromAddress, null]) {
          for (const adjacentToAddress of fragmentToAddress === null
            ? [fragmentToAddress]
            : [fragmentToAddress, null]) {
            adjacent.push(
              `trace_${chainId}_${adjacentFromAddress}_${adjacentToAddress}`,
            );
          }
        }

        fragments.push({ id, adjacent });
      }
    }
  }

  return fragments;
};
