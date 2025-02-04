import type {
  BlockFilter,
  Factory,
  Filter,
  LogFactory,
  LogFilter,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import type {
  Transaction,
  TransactionReceipt,
  Trace as UserTrace,
} from "@/types/eth.js";
import type {
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
} from "@/types/sync.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { type Address, hexToBigInt, hexToNumber } from "viem";

/** Returns true if `address` is an address filter. */
export const isAddressFactory = (
  address: Address | Address[] | Factory | undefined | null,
): address is LogFactory => {
  if (address === undefined || address === null || typeof address === "string")
    return false;
  return Array.isArray(address) ? isAddressFactory(address[0]) : true;
};

export const getChildAddress = ({
  log,
  factory,
}: { log: SyncLog; factory: Factory }): Address => {
  if (factory.childAddressLocation.startsWith("offset")) {
    const childAddressOffset = Number(
      factory.childAddressLocation.substring(6),
    );
    const start = 2 + 12 * 2 + childAddressOffset * 2;
    const length = 20 * 2;

    return `0x${log.data.substring(start, start + length)}`;
  } else {
    const start = 2 + 12 * 2;
    const length = 20 * 2;
    const topicIndex =
      factory.childAddressLocation === "topic1"
        ? 1
        : factory.childAddressLocation === "topic2"
          ? 2
          : 3;
    return `0x${log.topics[topicIndex]!.substring(start, start + length)}`;
  }
};

const isValueMatched = <T extends string>(
  filterValue: T | T[] | Set<T> | null | undefined,
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

  // set
  if (
    filterValue instanceof Set &&
    filterValue.has(toLowerCase(eventValue) as T)
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
  childAddresses,
}: {
  filter: LogFilter;
  block: SyncBlock;
  log: SyncLog;
  childAddresses?: Set<Address> | Set<Address>[];
}): boolean => {
  // Return `false` for out of range blocks
  if (
    hexToNumber(block.number) < (filter.fromBlock ?? 0) ||
    hexToNumber(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  if (isValueMatched(filter.topic0, log.topics[0]) === false) return false;
  if (isValueMatched(filter.topic1, log.topics[1]) === false) return false;
  if (isValueMatched(filter.topic2, log.topics[2]) === false) return false;
  if (isValueMatched(filter.topic3, log.topics[3]) === false) return false;

  if (isAddressFactory(filter.address)) {
    if (Array.isArray(childAddresses)) {
      if (
        childAddresses.every(
          (address) => isValueMatched(address, log.address) === false,
        )
      ) {
        return false;
      }
    } else {
      if (isValueMatched(childAddresses, log.address) === false) {
        return false;
      }
    }
  } else {
    if (isValueMatched(filter.address, log.address) === false) {
      return false;
    }
  }

  return true;
};

/**
 * Returns `true` if `transaction` matches `filter`
 */
export const isTransactionFilterMatched = ({
  filter,
  block,
  transaction,
  fromChildAddresses,
  toChildAddresses,
}: {
  filter: TransactionFilter;
  block: Pick<SyncBlock, "number">;
  transaction: SyncTransaction;
  fromChildAddresses?: Set<Address> | Set<Address>[];
  toChildAddresses?: Set<Address> | Set<Address>[];
}): boolean => {
  // Return `false` for out of range blocks
  if (
    hexToNumber(block.number) < (filter.fromBlock ?? 0) ||
    hexToNumber(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  if (isAddressFactory(filter.fromAddress)) {
    if (Array.isArray(fromChildAddresses)) {
      if (
        fromChildAddresses.every(
          (address) => isValueMatched(address, transaction.from) === false,
        )
      ) {
        return false;
      }
    } else {
      if (isValueMatched(fromChildAddresses, transaction.from) === false) {
        return false;
      }
    }
  } else {
    if (
      isValueMatched(
        filter.fromAddress as Address | Address[] | undefined,
        transaction.from,
      ) === false
    ) {
      return false;
    }
  }

  if (isAddressFactory(filter.toAddress)) {
    if (Array.isArray(toChildAddresses)) {
      if (
        transaction.to !== null &&
        toChildAddresses.every(
          (address) => isValueMatched(address, transaction.to!) === false,
        )
      ) {
        return false;
      }
    } else {
      if (
        transaction.to !== null &&
        isValueMatched(toChildAddresses, transaction.to) === false
      ) {
        return false;
      }
    }
  } else {
    if (
      transaction.to !== null &&
      isValueMatched(
        filter.toAddress as Address | Address[] | undefined,
        transaction.to,
      ) === false
    ) {
      return false;
    }
  }

  // NOTE: `filter.includeReverted` is intentionally ignored

  return true;
};

/**
 * Returns `true` if `trace` matches `filter`
 */
export const isTraceFilterMatched = ({
  filter,
  block,
  trace,
  fromChildAddresses,
  toChildAddresses,
}: {
  filter: TraceFilter;
  block: Pick<SyncBlock, "number">;
  trace: Omit<SyncTrace["trace"], "calls" | "logs">;
  fromChildAddresses?: Set<Address> | Set<Address>[];
  toChildAddresses?: Set<Address> | Set<Address>[];
}): boolean => {
  // Return `false` for out of range blocks
  if (
    hexToNumber(block.number) < (filter.fromBlock ?? 0) ||
    hexToNumber(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  if (isAddressFactory(filter.fromAddress)) {
    if (Array.isArray(fromChildAddresses)) {
      if (
        fromChildAddresses.every(
          (address) => isValueMatched(address, trace.from) === false,
        )
      ) {
        return false;
      }
    } else {
      if (isValueMatched(fromChildAddresses, trace.from) === false) {
        return false;
      }
    }
  } else {
    if (
      isValueMatched(
        filter.fromAddress as Address | Address[] | undefined,
        trace.from,
      ) === false
    ) {
      return false;
    }
  }

  if (isAddressFactory(filter.toAddress)) {
    if (Array.isArray(toChildAddresses)) {
      if (
        toChildAddresses.every(
          (address) => isValueMatched(address, trace.to) === false,
        )
      ) {
        return false;
      }
    } else {
      if (isValueMatched(toChildAddresses, trace.to) === false) {
        return false;
      }
    }
  } else {
    if (
      isValueMatched(
        filter.toAddress as Address | Address[] | undefined,
        trace.to,
      ) === false
    ) {
      return false;
    }
  }

  if (
    isValueMatched(filter.functionSelector, trace.input.slice(0, 10)) === false
  ) {
    return false;
  }

  // NOTE: `filter.callType` and `filter.includeReverted` is intentionally ignored

  return true;
};

/**
 * Returns `true` if `trace` matches `filter`
 */
export const isTransferFilterMatched = ({
  filter,
  block,
  trace,
  fromChildAddresses,
  toChildAddresses,
}: {
  filter: TransferFilter;
  block: Pick<SyncBlock, "number">;
  trace: Omit<SyncTrace["trace"], "calls" | "logs">;
  fromChildAddresses?: Set<Address> | Set<Address>[];
  toChildAddresses?: Set<Address> | Set<Address>[];
}): boolean => {
  // Return `false` for out of range blocks
  if (
    hexToNumber(block.number) < (filter.fromBlock ?? 0) ||
    hexToNumber(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  if (trace.value === undefined || hexToBigInt(trace.value) === 0n) {
    return false;
  }

  if (isAddressFactory(filter.fromAddress)) {
    if (Array.isArray(fromChildAddresses)) {
      if (
        fromChildAddresses.every(
          (address) => isValueMatched(address, trace.from) === false,
        )
      ) {
        return false;
      }
    } else {
      if (isValueMatched(fromChildAddresses, trace.from) === false) {
        return false;
      }
    }
  } else {
    if (
      isValueMatched(
        filter.fromAddress as Address | Address[] | undefined,
        trace.from,
      ) === false
    ) {
      return false;
    }
  }

  if (isAddressFactory(filter.toAddress)) {
    if (Array.isArray(toChildAddresses)) {
      if (
        toChildAddresses.every(
          (address) => isValueMatched(address, trace.to) === false,
        )
      ) {
        return false;
      }
    } else {
      if (isValueMatched(toChildAddresses, trace.to) === false) {
        return false;
      }
    }
  } else {
    if (
      isValueMatched(
        filter.toAddress as Address | Address[] | undefined,
        trace.to,
      ) === false
    ) {
      return false;
    }
  }

  // NOTE: `filter.includeReverted` is intentionally ignored

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
    hexToNumber(block.number) < (filter.fromBlock ?? 0) ||
    hexToNumber(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  return (hexToNumber(block.number) - filter.offset) % filter.interval === 0;
};

export const defaultBlockFilterInclude: Exclude<
  BlockFilter["include"],
  undefined
> = [
  "block.baseFeePerGas",
  "block.difficulty",
  "block.extraData",
  "block.gasLimit",
  "block.gasUsed",
  "block.hash",
  "block.logsBloom",
  "block.miner",
  "block.nonce",
  "block.number",
  "block.parentHash",
  "block.receiptsRoot",
  "block.sha3Uncles",
  "block.size",
  "block.stateRoot",
  "block.timestamp",
  "block.transactionsRoot",
];

const defaultTransactionInclude: `transaction.${keyof Transaction}`[] = [
  "transaction.from",
  "transaction.gas",
  "transaction.hash",
  "transaction.input",
  "transaction.nonce",
  "transaction.r",
  "transaction.s",
  "transaction.to",
  "transaction.transactionIndex",
  "transaction.v",
  "transaction.value",
  // NOTE: type specific properties are not included
];

export const defaultTransactionReceiptInclude: `transactionReceipt.${keyof TransactionReceipt}`[] =
  [
    "transactionReceipt.contractAddress",
    "transactionReceipt.cumulativeGasUsed",
    "transactionReceipt.effectiveGasPrice",
    "transactionReceipt.from",
    "transactionReceipt.gasUsed",
    "transactionReceipt.logsBloom",
    "transactionReceipt.status",
    "transactionReceipt.to",
    "transactionReceipt.type",
  ];

const defaultTraceInclude: `trace.${keyof UserTrace}`[] = [
  "trace.id",
  "trace.traceIndex",
  "trace.type",
  "trace.from",
  "trace.to",
  "trace.gas",
  "trace.gasUsed",
  "trace.input",
  "trace.output",
  "trace.error",
  "trace.revertReason",
  "trace.value",
];

export const defaultLogFilterInclude: Exclude<LogFilter["include"], undefined> =
  [
    "log.id",
    "log.address",
    "log.data",
    "log.logIndex",
    "log.removed",
    "log.topics",
    ...defaultTransactionInclude,
    ...defaultBlockFilterInclude,
  ];

export const defaultTransactionFilterInclude: Exclude<
  TransactionFilter["include"],
  undefined
> = [
  ...defaultTransactionInclude,
  ...defaultTransactionReceiptInclude,
  ...defaultBlockFilterInclude,
];

export const defaultTraceFilterInclude: Exclude<
  TraceFilter["include"],
  undefined
> = [
  ...defaultBlockFilterInclude,
  ...defaultTransactionInclude,
  ...defaultTraceInclude,
];

export const defaultTransferFilterInclude: Exclude<
  TransferFilter["include"],
  undefined
> = [
  ...defaultBlockFilterInclude,
  ...defaultTransactionInclude,
  ...defaultTraceInclude,
];

export const shouldGetTransactionReceipt = (
  filter: Pick<Filter, "include" | "type">,
): boolean => {
  // transactions must request receipts for "reverted" information
  if (filter.type === "transaction") return true;

  if (filter.type === "block") return false;

  // TODO(kyle) should include be a required property?
  if (filter.include === undefined) return true;

  if (filter.include.some((prop) => prop.startsWith("transactionReceipt."))) {
    return true;
  }

  return false;
};
