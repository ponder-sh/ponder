import type { Address, Hex } from "viem";
import {
  type BlockFilter,
  type Factory,
  type Filter,
  type LogFilter,
  type TraceFilter,
  type TransactionFilter,
  type TransferFilter,
  isAddressFactory,
  shouldGetTransactionReceipt,
} from "./source.js";

type FragmentAddress =
  | Address
  | `${Address}_${Factory["eventSelector"]}_${Factory["childAddressLocation"]}`
  | null;
type FragmentTopic = Hex | null;

export type FragmentId =
  /** block_{chainId}_{interval}_{offset} */
  | `block_${number}_${number}_${number}`
  /** transaction_{chainId}_{fromAddress}_{toAddress} */
  | `transaction_${number}_${FragmentAddress}_${FragmentAddress}`
  /** trace_{chainId}_{fromAddress}_{toAddress}_{functionSelector}_{includeReceipts} */
  | `trace_${number}_${FragmentAddress}_${FragmentAddress}_${Hex | null}_${0 | 1}`
  /** log_{chainId}_{address}_{topic0}_{topic1}_{topic2}_{topic3}_{includeReceipts} */
  | `log_${number}_${FragmentAddress}_${FragmentTopic}_${FragmentTopic}_${FragmentTopic}_${FragmentTopic}_${0 | 1}`
  /** transfer_{chainId}_{fromAddress}_{toAddress}_{includeReceipts} */
  | `transfer_${number}_${FragmentAddress}_${FragmentAddress}_${0 | 1}`;

export const getFragmentIds = (
  filter: Omit<Filter, "fromBlock" | "toBlock">,
): FragmentReturnType => {
  switch (filter.type) {
    case "block":
      return getBlockFilterFragmentId(filter as BlockFilter);
    case "transaction":
      return getTransactionFilterFragmentIds(filter as TransactionFilter);
    case "trace":
      return getTraceFilterFragmentIds(filter as TraceFilter);
    case "log":
      return getLogFilterFragmentIds(filter as LogFilter);
    case "transfer":
      return getTransferFilterFragmentIds(filter as TransferFilter);
  }
};

type FragmentReturnType = {
  id: FragmentId;
  adjacent: FragmentId[];
}[];

const getAddressFragmentIds = (
  address: Address | Address[] | Factory | undefined,
) => {
  const fragments: { id: FragmentAddress; adjacent: FragmentAddress[] }[] = [];

  if (isAddressFactory(address)) {
    for (const fragmentAddress of Array.isArray(address.address)
      ? address.address
      : [address.address]) {
      const id =
        `${fragmentAddress}_${address.eventSelector}_${address.childAddressLocation}` as const;

      fragments.push({ id, adjacent: [id] });
    }
  } else {
    for (const fragmentAddress of Array.isArray(address)
      ? address
      : [address ?? null]) {
      fragments.push({
        id: fragmentAddress,
        adjacent: fragmentAddress ? [fragmentAddress, null] : [fragmentAddress],
      });
    }
  }

  return fragments;
};

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

export const getTransactionFilterFragmentIds = ({
  chainId,
  fromAddress,
  toAddress,
}: Omit<TransactionFilter, "fromBlock" | "toBlock"> & {
  chainId: number;
}): FragmentReturnType => {
  const fragments: FragmentReturnType = [];
  const fromAddressFragmentIds = getAddressFragmentIds(fromAddress);
  const toAddressFragmentIds = getAddressFragmentIds(toAddress);

  for (const fragmentFromAddress of fromAddressFragmentIds) {
    for (const fragmentToAddress of toAddressFragmentIds) {
      const id =
        `transaction_${chainId}_${fragmentFromAddress.id}_${fragmentToAddress.id}` as const;

      const adjacent: FragmentId[] = [];

      for (const adjacentFromAddress of fragmentFromAddress.adjacent) {
        for (const adjacentToAddress of fragmentToAddress.adjacent) {
          adjacent.push(
            `transaction_${chainId}_${adjacentFromAddress}_${adjacentToAddress}`,
          );
        }
      }

      fragments.push({ id, adjacent });
    }
  }

  return fragments;
};

export const getTraceFilterFragmentIds = ({
  chainId,
  fromAddress,
  toAddress,
  callType,
  functionSelector,
  ...filter
}: Omit<TraceFilter, "fromBlock" | "toBlock"> & {
  chainId: number;
}): FragmentReturnType => {
  const fragments: FragmentReturnType = [];
  const fromAddressFragmentIds = getAddressFragmentIds(fromAddress);
  const toAddressFragmentIds = getAddressFragmentIds(toAddress);
  const includeTransactionReceipts = shouldGetTransactionReceipt(filter);

  for (const fragmentFromAddress of fromAddressFragmentIds) {
    for (const fragmentToAddress of toAddressFragmentIds) {
      for (const fragmentFunctionSelector of Array.isArray(functionSelector)
        ? functionSelector
        : [functionSelector]) {
        const id =
          `trace_${chainId}_${fragmentFromAddress.id}_${fragmentToAddress.id}_${fragmentFunctionSelector ?? null}_${includeTransactionReceipts ? 1 : 0}` as const;

        const adjacent: FragmentId[] = [];

        for (const adjacentFromAddress of fragmentFromAddress.adjacent) {
          for (const adjacentToAddress of fragmentToAddress.adjacent) {
            for (const adjacentFunctionSelector of fragmentFunctionSelector
              ? [fragmentFunctionSelector, null]
              : [null]) {
              for (const adjacentTxr of includeTransactionReceipts
                ? [1]
                : [0, 1]) {
                adjacent.push(
                  `trace_${chainId}_${adjacentFromAddress}_${adjacentToAddress}_${adjacentFunctionSelector}_${adjacentTxr as 0 | 1}`,
                );
              }
            }
          }
        }

        fragments.push({ id, adjacent });
      }
    }
  }

  return fragments;
};

export const getLogFilterFragmentIds = ({
  chainId,
  address,
  topic0,
  topic1,
  topic2,
  topic3,
  ...filter
}: Omit<LogFilter, "fromBlock" | "toBlock">): FragmentReturnType => {
  const fragments: FragmentReturnType = [];
  const addressFragmentIds = getAddressFragmentIds(address);
  const includeTransactionReceipts = shouldGetTransactionReceipt(filter);

  for (const fragmentAddress of addressFragmentIds) {
    for (const fragmentTopic0 of Array.isArray(topic0) ? topic0 : [topic0]) {
      for (const fragmentTopic1 of Array.isArray(topic1) ? topic1 : [topic1]) {
        for (const fragmentTopic2 of Array.isArray(topic2)
          ? topic2
          : [topic2]) {
          for (const fragmentTopic3 of Array.isArray(topic3)
            ? topic3
            : [topic3]) {
            const id =
              `log_${chainId}_${fragmentAddress.id}_${fragmentTopic0 ?? null}_${fragmentTopic1 ?? null}_${fragmentTopic2 ?? null}_${fragmentTopic3 ?? null}_${includeTransactionReceipts ? 1 : 0}` as const;

            const adjacent: FragmentId[] = [];

            for (const adjacentAddress of fragmentAddress.adjacent) {
              for (const adjacentTopic0 of fragmentTopic0
                ? [fragmentTopic0, null]
                : [null]) {
                for (const adjacentTopic1 of fragmentTopic1
                  ? [fragmentTopic1, null]
                  : [null]) {
                  for (const adjacentTopic2 of fragmentTopic2
                    ? [fragmentTopic2, null]
                    : [null]) {
                    for (const adjacentTopic3 of fragmentTopic3
                      ? [fragmentTopic3, null]
                      : [null]) {
                      for (const adjacentTxr of includeTransactionReceipts
                        ? [1]
                        : [0, 1]) {
                        adjacent.push(
                          `log_${chainId}_${adjacentAddress}_${adjacentTopic0}_${adjacentTopic1}_${adjacentTopic2}_${adjacentTopic3}_${adjacentTxr as 0 | 1}`,
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

  return fragments;
};

export const getTransferFilterFragmentIds = ({
  chainId,
  fromAddress,
  toAddress,
  ...filter
}: Omit<TransferFilter, "fromBlock" | "toBlock"> & {
  chainId: number;
}): FragmentReturnType => {
  const fragments: FragmentReturnType = [];
  const fromAddressFragmentIds = getAddressFragmentIds(fromAddress);
  const toAddressFragmentIds = getAddressFragmentIds(toAddress);
  const includeTransactionReceipts = shouldGetTransactionReceipt(filter);

  for (const fragmentFromAddress of fromAddressFragmentIds) {
    for (const fragmentToAddress of toAddressFragmentIds) {
      const id =
        `transfer_${chainId}_${fragmentFromAddress.id}_${fragmentToAddress.id}_${includeTransactionReceipts ? 1 : 0}` as const;

      const adjacent: FragmentId[] = [];

      for (const adjacentFromAddress of fragmentFromAddress.adjacent) {
        for (const adjacentToAddress of fragmentToAddress.adjacent) {
          for (const adjacentTxr of includeTransactionReceipts ? [1] : [0, 1]) {
            adjacent.push(
              `transfer_${chainId}_${adjacentFromAddress}_${adjacentToAddress}_${adjacentTxr as 0 | 1}`,
            );
          }
        }
      }

      fragments.push({ id, adjacent });
    }
  }

  return fragments;
};

export const recoverFilter = (
  fragmentIds: FragmentId[],
): Omit<Filter, "fromBlock" | "toBlock"> => {};
