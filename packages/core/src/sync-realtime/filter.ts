import {
  type TransactionFilterFragment,
  type TransferFilterFragment,
  buildLogFilterFragments,
  buildTransactionFilterFragments,
  buildTransferFilterFragments,
} from "@/sync/fragments.js";
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
import { type Hex, hexToNumber } from "viem";

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

// /**
//  * Returns `true` if `callTrace` matches `filter`
//  */
// export const isCallTraceFilterMatched = ({
//   filter,
//   block,
//   callTrace,
// }: {
//   filter: CallTraceFilter;
//   block: SyncBlock;
//   callTrace: SyncCallTrace;
// }): boolean => {
//   // Return `false` for out of range blocks
//   if (
//     hexToNumber(block.number) < filter.fromBlock ||
//     hexToNumber(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
//   ) {
//     return false;
//   }

//   return buildTraceFilterFragments(filter).some((fragment) => {
//     if (
//       fragment.fromAddress !== null &&
//       fragment.fromAddress !== callTrace.action.from.toLowerCase()
//     ) {
//       return false;
//     }

//     if (
//       isAddressFactory(filter.toAddress) === false &&
//       (fragment as TraceFilterFragment<undefined>).toAddress !== null &&
//       (fragment as TraceFilterFragment<undefined>).toAddress !==
//         callTrace.action.to.toLowerCase()
//     ) {
//       return false;
//     }

//     return true;
//   });
// };

/**
 * Returns `true` if `trace` matches `filter`
 */
export const isTransactionFilterMatched = ({
  filter,
  block,
  trace,
}: {
  filter: TransactionFilter;
  block: SyncBlock;
  trace: SyncTrace;
}): boolean => {
  // Return `false` for out of range blocks
  if (
    hexToNumber(block.number) < filter.fromBlock ||
    hexToNumber(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  const isTransactionFragmentMatched = ({
    fragment,
    trace,
  }: {
    fragment: TransactionFilterFragment;
    trace: SyncTrace;
  }): { failed: boolean; matched: boolean } => {
    const selector = trace.result.input.slice(0, 10) as Hex;
    const isCallTypeMatched =
      fragment.callType === null || fragment.callType === trace.result.type;
    const isSelectorMatched =
      fragment.functionSelector === null ||
      fragment.functionSelector === selector;
    const isFromAddressMatched = isAddressFactory(filter.fromAddress)
      ? true
      : fragment.fromAddress === null
        ? true
        : fragment.fromAddress === trace.result.from;
    const isToAddressMatched = isAddressFactory(filter.toAddress)
      ? true
      : fragment.toAddress === null
        ? true
        : fragment.toAddress === trace.result.to;

    let isMatched =
      isCallTypeMatched &&
      isSelectorMatched &&
      isFromAddressMatched &&
      isToAddressMatched;

    let isFailed =
      trace.result.error !== undefined ||
      trace.result.revertReason !== undefined;

    const calls = trace.result.calls;
    if (calls !== undefined && fragment.includeInner) {
      for (const call of calls) {
        // Return early if failed or filter matched
        if (
          (fragment.includeFailed === 0 && isFailed) ||
          (fragment.includeFailed === 1 && isMatched)
        ) {
          return {
            failed: isFailed,
            matched: isMatched,
          };
        }

        const { failed, matched } = isTransactionFragmentMatched({
          fragment,
          trace: {
            txHash: trace.txHash,
            result: call,
          },
        });
        isFailed = isFailed || failed;
        isMatched = isMatched || matched;
      }
    }

    return {
      failed: isFailed,
      matched: isMatched,
    };
  };

  return buildTransactionFilterFragments(filter).some((fragment) => {
    const { failed, matched } = isTransactionFragmentMatched({
      fragment,
      trace,
    });
    return fragment.includeFailed === 0 && failed ? false : matched;
  });
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
  block: SyncBlock;
  trace: SyncTrace;
}): boolean => {
  // Return `false` for out of range blocks
  if (
    hexToNumber(block.number) < filter.fromBlock ||
    hexToNumber(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  const isTransferFragmentMatched = ({
    fragment,
    trace,
  }: {
    fragment: TransferFilterFragment;
    trace: SyncTrace;
  }): boolean => {
    const isInputMatched = trace.result.input === "0x";
    const isFromAddressMatched = isAddressFactory(filter.fromAddress)
      ? true
      : fragment.fromAddress === null
        ? true
        : fragment.fromAddress === trace.result.from;
    const isToAddressMatched = isAddressFactory(filter.toAddress)
      ? true
      : fragment.toAddress === null
        ? true
        : fragment.toAddress === trace.result.to;

    const isMatched =
      isInputMatched && isFromAddressMatched && isToAddressMatched;

    // TODO: check for errors and reverts (logic to stop traversing when failed found)

    const calls = trace.result.calls;
    if (calls !== undefined) {
      return (
        isMatched ||
        calls.some((call) => {
          isTransferFragmentMatched({
            fragment,
            trace: {
              txHash: trace.txHash,
              result: call,
            },
          });
        })
      );
    }

    return isMatched;
  };

  return buildTransferFilterFragments(filter).some((fragment) =>
    isTransferFragmentMatched({ fragment, trace }),
  );
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
