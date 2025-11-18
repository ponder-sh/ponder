import type {
  BlockFilter,
  Factory,
  Filter,
  InternalBlock,
  InternalLog,
  InternalTrace,
  InternalTransaction,
  LogFactory,
  LogFilter,
  RequiredBlockColumns,
  RequiredLogColumns,
  RequiredTraceColumns,
  RequiredTransactionColumns,
  RequiredTransactionReceiptColumns,
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import type {
  Block,
  Log,
  Trace,
  Transaction,
  TransactionReceipt,
} from "@/types/eth.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { type Address, hexToNumber } from "viem";

/** Returns true if `address` is an address filter. */
export const isAddressFactory = (
  address: Address | Address[] | Factory | undefined | null,
): address is LogFactory => {
  if (
    address === undefined ||
    address === null ||
    typeof address === "string"
  ) {
    return false;
  }
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
 * Returns `true` if `log` matches `factory`
 */
export const isLogFactoryMatched = ({
  factory,
  log,
}: { factory: LogFactory; log: InternalLog | SyncLog }): boolean => {
  if (factory.address !== undefined) {
    const addresses = Array.isArray(factory.address)
      ? factory.address
      : [factory.address];

    if (addresses.every((address) => address !== toLowerCase(log.address))) {
      return false;
    }
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
  block: Pick<InternalBlock | SyncBlock | SyncBlockHeader, "number">;
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

export const getFilterFactories = (filter: Filter): Factory[] => {
  const factories: Factory[] = [];
  switch (filter.type) {
    case "log":
      if (isAddressFactory(filter.address)) {
        factories.push(filter.address);
      }
      break;
    case "trace":
    case "transfer":
    case "transaction": {
      if (isAddressFactory(filter.fromAddress)) {
        factories.push(filter.fromAddress);
      }
      if (isAddressFactory(filter.toAddress)) {
        factories.push(filter.toAddress);
      }
      break;
    }
  }
  return factories;
};

export const getFilterFromBlock = (filter: Filter): number => {
  const blocks: number[] = [filter.fromBlock ?? 0];
  switch (filter.type) {
    case "log":
      if (isAddressFactory(filter.address)) {
        blocks.push(filter.address.fromBlock ?? 0);
      }
      break;
    case "transaction":
    case "trace":
    case "transfer":
      if (isAddressFactory(filter.fromAddress)) {
        blocks.push(filter.fromAddress.fromBlock ?? 0);
      }

      if (isAddressFactory(filter.toAddress)) {
        blocks.push(filter.toAddress.fromBlock ?? 0);
      }
  }

  return Math.min(...blocks);
};

export const getFilterToBlock = (filter: Filter): number => {
  const blocks: number[] = [filter.toBlock ?? Number.POSITIVE_INFINITY];

  // Note: factories cannot have toBlock > `filter.toBlock`

  switch (filter.type) {
    case "log":
      if (isAddressFactory(filter.address)) {
        blocks.push(filter.address.toBlock ?? Number.POSITIVE_INFINITY);
      }
      break;
    case "transaction":
    case "trace":
    case "transfer":
      if (isAddressFactory(filter.fromAddress)) {
        blocks.push(filter.fromAddress.toBlock ?? Number.POSITIVE_INFINITY);
      }

      if (isAddressFactory(filter.toAddress)) {
        blocks.push(filter.toAddress.toBlock ?? Number.POSITIVE_INFINITY);
      }
  }

  return Math.max(...blocks);
};

export const isBlockInFilter = (filter: Filter, blockNumber: number) => {
  // Return `false` for out of range blocks
  if (
    blockNumber < (filter.fromBlock ?? 0) ||
    blockNumber > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  return true;
};

export const defaultBlockInclude: (keyof Block)[] = [
  "baseFeePerGas",
  "difficulty",
  "extraData",
  "gasLimit",
  "gasUsed",
  "hash",
  "logsBloom",
  "miner",
  "mixHash",
  "totalDifficulty",
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

export const requiredBlockInclude: RequiredBlockColumns[] = [
  "timestamp",
  "number",
  "hash",
];

export const defaultTransactionInclude: (keyof Transaction)[] = [
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

export const requiredTransactionInclude: RequiredTransactionColumns[] = [
  "transactionIndex",
  "from",
  "to",
  "hash",
  "type",
];

export const defaultTransactionReceiptInclude: (keyof TransactionReceipt)[] = [
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

export const requiredTransactionReceiptInclude: RequiredTransactionReceiptColumns[] =
  ["status", "from", "to"];

export const defaultTraceInclude: (keyof Trace)[] = [
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
  "subcalls",
];

export const requiredTraceInclude: RequiredTraceColumns[] = [
  "traceIndex",
  "type",
  "from",
  "to",
  "input",
  "output",
  "error",
  "value",
];

export const defaultLogInclude: (keyof Log)[] = [
  "address",
  "data",
  "logIndex",
  "removed",
  "topics",
];

export const requiredLogInclude: RequiredLogColumns[] = defaultLogInclude;

export const defaultBlockFilterInclude: BlockFilter["include"] =
  defaultBlockInclude.map((value) => `block.${value}` as const);

export const requiredBlockFilterInclude: BlockFilter["include"] =
  requiredBlockInclude.map((value) => `block.${value}` as const);

export const defaultLogFilterInclude: LogFilter["include"] = [
  ...defaultLogInclude.map((value) => `log.${value}` as const),
  ...defaultTransactionInclude.map((value) => `transaction.${value}` as const),
  ...defaultBlockInclude.map((value) => `block.${value}` as const),
];

export const requiredLogFilterInclude: LogFilter["include"] = [
  ...requiredLogInclude.map((value) => `log.${value}` as const),
  ...requiredTransactionInclude.map((value) => `transaction.${value}` as const),
  ...requiredBlockInclude.map((value) => `block.${value}` as const),
];

export const defaultTransactionFilterInclude: TransactionFilter["include"] = [
  ...defaultTransactionInclude.map((value) => `transaction.${value}` as const),
  ...defaultTransactionReceiptInclude.map(
    (value) => `transactionReceipt.${value}` as const,
  ),
  ...defaultBlockInclude.map((value) => `block.${value}` as const),
];

export const requiredTransactionFilterInclude: TransactionFilter["include"] = [
  ...requiredTransactionInclude.map((value) => `transaction.${value}` as const),
  ...requiredTransactionReceiptInclude.map(
    (value) => `transactionReceipt.${value}` as const,
  ),
  ...requiredBlockInclude.map((value) => `block.${value}` as const),
];

export const defaultTraceFilterInclude: TraceFilter["include"] = [
  ...defaultBlockInclude.map((value) => `block.${value}` as const),
  ...defaultTransactionInclude.map((value) => `transaction.${value}` as const),
  ...defaultTraceInclude.map((value) => `trace.${value}` as const),
];

export const requiredTraceFilterInclude: TraceFilter["include"] = [
  ...requiredBlockInclude.map((value) => `block.${value}` as const),
  ...requiredTransactionInclude.map((value) => `transaction.${value}` as const),
  ...requiredTraceInclude.map((value) => `trace.${value}` as const),
];

export const defaultTransferFilterInclude: TransferFilter["include"] = [
  ...defaultBlockInclude.map((value) => `block.${value}` as const),
  ...defaultTransactionInclude.map((value) => `transaction.${value}` as const),
  ...defaultTraceInclude.map((value) => `trace.${value}` as const),
];

export const requiredTransferFilterInclude: TransferFilter["include"] = [
  ...requiredBlockInclude.map((value) => `block.${value}` as const),
  ...requiredTransactionInclude.map((value) => `transaction.${value}` as const),
  ...requiredTraceInclude.map((value) => `trace.${value}` as const),
];

export const unionFilterIncludeBlock = (filters: Filter[]): (keyof Block)[] => {
  const includeBlock = new Set<keyof Block>();
  for (const filter of filters) {
    for (const include of filter.include) {
      const [data, column] = include.split(".") as [string, keyof Block];
      if (data === "block") {
        includeBlock.add(column);
      }
    }
  }
  return Array.from(includeBlock);
};

export const unionFilterIncludeTransaction = (
  filters: Filter[],
): (keyof Transaction)[] => {
  const includeTransaction = new Set<keyof Transaction>();
  for (const filter of filters) {
    for (const include of filter.include) {
      const [data, column] = include.split(".") as [string, keyof Transaction];
      if (data === "transaction") {
        includeTransaction.add(column);
      }
    }
  }
  return Array.from(includeTransaction);
};

export const unionFilterIncludeTransactionReceipt = (
  filters: Filter[],
): (keyof TransactionReceipt)[] => {
  const includeTransactionReceipt = new Set<keyof TransactionReceipt>();
  for (const filter of filters) {
    for (const include of filter.include) {
      const [data, column] = include.split(".") as [
        string,
        keyof TransactionReceipt,
      ];
      if (data === "transactionReceipt") {
        includeTransactionReceipt.add(column);
      }
    }
  }
  return Array.from(includeTransactionReceipt);
};

export const unionFilterIncludeTrace = (filters: Filter[]): (keyof Trace)[] => {
  const includeTrace = new Set<keyof Trace>();
  for (const filter of filters) {
    for (const include of filter.include) {
      const [data, column] = include.split(".") as [string, keyof Trace];
      if (data === "trace") {
        includeTrace.add(column);
      }
    }
  }
  return Array.from(includeTrace);
};
