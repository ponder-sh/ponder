import type {
  BlockFilter,
  Factory,
  Filter,
  InternalBlock,
  InternalLog,
  InternalTrace,
  InternalTransaction,
  InternalTransactionReceipt,
  LogFactory,
  LogFilter,
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { type Address, hexToNumber } from "viem";

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

export const isAddressMatched = ({
  address,
  blockNumber,
  childAddresses,
}: {
  address: Address | undefined;
  blockNumber: number;
  childAddresses: Map<Address, number>;
}) => {
  if (address === undefined) return false;
  if (
    childAddresses.has(toLowerCase(address)) &&
    childAddresses.get(toLowerCase(address))! <= blockNumber
  ) {
    return true;
  }

  return false;
};

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
  factory,
  log,
}: { factory: LogFactory; log: InternalLog | SyncLog }): boolean => {
  const addresses = Array.isArray(factory.address)
    ? factory.address
    : [factory.address];

  if (addresses.every((address) => address !== toLowerCase(log.address))) {
    return false;
  }
  if (log.topics.length === 0) return false;
  if (factory.eventSelector !== toLowerCase(log.topics[0]!)) return false;
  if (
    factory.fromBlock !== undefined &&
    (typeof log.blockNumber === "number"
      ? factory.fromBlock > log.blockNumber
      : factory.fromBlock > hexToNumber(log.blockNumber))
  )
    return false;
  if (
    factory.toBlock !== undefined &&
    (typeof log.blockNumber === "number"
      ? factory.toBlock < log.blockNumber
      : factory.toBlock < hexToNumber(log.blockNumber))
  )
    return false;

  return true;
};

/**
 * Returns `true` if `log` matches `filter`
 */
export const isLogFilterMatched = ({
  filter,
  log,
}: {
  filter: LogFilter;
  log: InternalLog | SyncLog;
}): boolean => {
  // Return `false` for out of range blocks
  if (
    Number(log.blockNumber) < (filter.fromBlock ?? 0) ||
    Number(log.blockNumber) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  if (isValueMatched(filter.topic0, log.topics[0]) === false) return false;
  if (isValueMatched(filter.topic1, log.topics[1]) === false) return false;
  if (isValueMatched(filter.topic2, log.topics[2]) === false) return false;
  if (isValueMatched(filter.topic3, log.topics[3]) === false) return false;

  if (
    isAddressFactory(filter.address) === false &&
    isValueMatched(
      filter.address as Address | Address[] | undefined,
      log.address,
    ) === false
  ) {
    return false;
  }

  return true;
};

/**
 * Returns `true` if `transaction` matches `filter`
 */
export const isTransactionFilterMatched = ({
  filter,
  transaction,
}: {
  filter: TransactionFilter;
  transaction: InternalTransaction | SyncTransaction;
}): boolean => {
  // Return `false` for out of range blocks
  if (
    Number(transaction.blockNumber) < (filter.fromBlock ?? 0) ||
    Number(transaction.blockNumber) >
      (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  if (
    isAddressFactory(filter.fromAddress) === false &&
    isValueMatched(
      filter.fromAddress as Address | Address[] | undefined,
      transaction.from,
    ) === false
  ) {
    return false;
  }

  if (
    isAddressFactory(filter.toAddress) === false &&
    isValueMatched(
      filter.toAddress as Address | Address[] | undefined,
      transaction.to ?? undefined,
    ) === false
  ) {
    return false;
  }

  // NOTE: `filter.includeReverted` is intentionally ignored

  return true;
};

/**
 * Returns `true` if `trace` matches `filter`
 */
export const isTraceFilterMatched = ({
  filter,
  trace,
  block,
}: {
  filter: TraceFilter;
  trace: InternalTrace | SyncTrace["trace"];
  block: Pick<InternalBlock | SyncBlock, "number">;
}): boolean => {
  // Return `false` for out of range blocks
  if (
    Number(block.number) < (filter.fromBlock ?? 0) ||
    Number(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
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
      trace.to ?? undefined,
    ) === false
  ) {
    return false;
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
  trace,
  block,
}: {
  filter: TransferFilter;
  trace: InternalTrace | SyncTrace["trace"];
  block: Pick<InternalBlock | SyncBlock, "number">;
}): boolean => {
  // Return `false` for out of range blocks
  if (
    Number(block.number) < (filter.fromBlock ?? 0) ||
    Number(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  if (
    trace.value === undefined ||
    trace.value === null ||
    BigInt(trace.value) === 0n
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
      trace.to ?? undefined,
    ) === false
  ) {
    return false;
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
  block: InternalBlock | SyncBlock | SyncBlockHeader;
}): boolean => {
  // Return `false` for out of range blocks
  if (
    Number(block.number) < (filter.fromBlock ?? 0) ||
    Number(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  return (Number(block.number) - filter.offset) % filter.interval === 0;
};

export const defaultTransactionInclude: (keyof InternalTransaction)[] = [
  "from",
  "gas",
  "hash",
  "input",
  "nonce",
  "r",
  "s",
  "to",
  "transactionIndex",
  "v",
  "value",
  "type",
  "gasPrice",
  "accessList",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
];

export const defaultTransactionReceiptInclude: (keyof InternalTransactionReceipt)[] =
  [
    "contractAddress",
    "cumulativeGasUsed",
    "effectiveGasPrice",
    "from",
    "gasUsed",
    "logsBloom",
    "status",
    "to",
    "type",
  ];

export const defaultTraceInclude: (keyof InternalTrace)[] = [
  "traceIndex",
  "type",
  "from",
  "to",
  "gas",
  "gasUsed",
  "input",
  "output",
  "error",
  "revertReason",
  "value",
];

export const defaultLogInclude: (keyof InternalLog)[] = [
  "address",
  "data",
  "logIndex",
  "removed",
  "topics",
];

export const defaultBlockInclude: (keyof InternalBlock)[] = [
  "baseFeePerGas",
  "difficulty",
  "extraData",
  "gasLimit",
  "gasUsed",
  "hash",
  "logsBloom",
  "miner",
  "mixHash",
  "nonce",
  "number",
  "parentHash",
  "receiptsRoot",
  "sha3Uncles",
  "size",
  "stateRoot",
  "timestamp",
  "transactionsRoot",
];

export const defaultBlockFilterInclude: Exclude<
  BlockFilter["include"],
  undefined
> = defaultBlockInclude.map(
  (value) => `block.${value}` as `block.${keyof InternalBlock}`,
);

export const defaultLogFilterInclude: Exclude<LogFilter["include"], undefined> =
  [
    ...defaultLogInclude.map(
      (value) => `log.${value}` as `log.${keyof InternalLog}`,
    ),
    ...defaultTransactionInclude.map(
      (value) =>
        `transaction.${value}` as `transaction.${keyof InternalTransaction}`,
    ),
    ...defaultBlockFilterInclude.map(
      (value) => `block.${value}` as `block.${keyof InternalBlock}`,
    ),
  ];

export const defaultTransactionFilterInclude: Exclude<
  TransactionFilter["include"],
  undefined
> = [
  ...defaultTransactionInclude.map(
    (value) =>
      `transaction.${value}` as `transaction.${keyof InternalTransaction}`,
  ),
  ...defaultTransactionReceiptInclude.map(
    (value) =>
      `transactionReceipt.${value}` as `transactionReceipt.${keyof InternalTransactionReceipt}`,
  ),
  ...defaultBlockFilterInclude.map(
    (value) => `block.${value}` as `block.${keyof InternalBlock}`,
  ),
];

export const defaultTraceFilterInclude: Exclude<
  TraceFilter["include"],
  undefined
> = [
  ...defaultBlockFilterInclude.map(
    (value) => `block.${value}` as `block.${keyof InternalBlock}`,
  ),
  ...defaultTransactionInclude.map(
    (value) =>
      `transaction.${value}` as `transaction.${keyof InternalTransaction}`,
  ),
  ...defaultTraceInclude.map(
    (value) => `trace.${value}` as `trace.${keyof InternalTrace}`,
  ),
];

export const defaultTransferFilterInclude: Exclude<
  TransferFilter["include"],
  undefined
> = [
  ...defaultBlockFilterInclude.map(
    (value) => `block.${value}` as `block.${keyof InternalBlock}`,
  ),
  ...defaultTransactionInclude.map(
    (value) =>
      `transaction.${value}` as `transaction.${keyof InternalTransaction}`,
  ),
  ...defaultTraceInclude.map(
    (value) => `trace.${value}` as `trace.${keyof InternalTrace}`,
  ),
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
