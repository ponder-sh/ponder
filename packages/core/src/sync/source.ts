import type { AbiEvents, AbiFunctions } from "@/sync/abi.js";
import type {
  Block,
  Log,
  Transaction,
  TransactionReceipt,
  Trace as UserTrace,
} from "@/types/eth.js";
import type { SyncLog } from "@/types/sync.js";
import type { Trace } from "@/utils/debug.js";
import type { Abi, Address, Hex, LogTopic } from "viem";

export type Source = ContractSource | AccountSource | BlockSource;
export type ContractSource<
  filter extends "log" | "trace" = "log" | "trace",
  factory extends Factory | undefined = Factory | undefined,
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  filter: filter extends "log"
    ? LogFilter<factory>
    : TraceFilter<fromFactory, toFactory>;
} & ContractMetadata;

export type AccountSource<
  filter extends "transaction" | "transfer" = "transaction" | "transfer",
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  filter: filter extends "transaction"
    ? TransactionFilter<fromFactory, toFactory>
    : TransferFilter<fromFactory, toFactory>;
} & AccountMetadata;

export type BlockSource = { filter: BlockFilter } & BlockMetadata;

export type Filter =
  | LogFilter
  | BlockFilter
  | TransferFilter
  | TransactionFilter
  | TraceFilter;
export type FilterWithoutBlocks =
  | Omit<BlockFilter, "fromBlock" | "toBlock">
  | Omit<TransactionFilter, "fromBlock" | "toBlock">
  | Omit<TraceFilter, "fromBlock" | "toBlock">
  | Omit<LogFilter, "fromBlock" | "toBlock">
  | Omit<TransferFilter, "fromBlock" | "toBlock">;
export type Factory = LogFactory;
export type FilterAddress<
  factory extends Factory | undefined = Factory | undefined,
> = factory extends Factory ? factory : Address | Address[] | undefined;

export type ContractMetadata = {
  type: "contract";
  abi: Abi;
  abiEvents: AbiEvents;
  abiFunctions: AbiFunctions;
  name: string;
  networkName: string;
};
export type AccountMetadata = {
  type: "account";
  name: string;
  networkName: string;
};
export type BlockMetadata = {
  type: "block";
  name: string;
  networkName: string;
};

export type LogFilter<
  factory extends Factory | undefined = Factory | undefined,
> = {
  type: "log";
  chainId: number;
  address: FilterAddress<factory>;
  topic0: LogTopic;
  topic1: LogTopic;
  topic2: LogTopic;
  topic3: LogTopic;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  include:
    | (
        | `block.${keyof Block}`
        | `transaction.${keyof Transaction}`
        | `transactionReceipt.${keyof TransactionReceipt}`
        | `log.${keyof Log}`
      )[]
    | undefined;
};

export type BlockFilter = {
  type: "block";
  chainId: number;
  interval: number;
  offset: number;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  include: `block.${keyof Block}`[] | undefined;
};

export type TransferFilter<
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  type: "transfer";
  chainId: number;
  fromAddress: FilterAddress<fromFactory>;
  toAddress: FilterAddress<toFactory>;
  includeReverted: boolean;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  include:
    | (
        | `block.${keyof Block}`
        | `transaction.${keyof Transaction}`
        | `transactionReceipt.${keyof TransactionReceipt}`
        | `trace.${keyof UserTrace}`
      )[]
    | undefined;
};

export type TransactionFilter<
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  type: "transaction";
  chainId: number;
  fromAddress: FilterAddress<fromFactory>;
  toAddress: FilterAddress<toFactory>;
  includeReverted: boolean;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  include:
    | (
        | `block.${keyof Block}`
        | `transaction.${keyof Transaction}`
        | `transactionReceipt.${keyof TransactionReceipt}`
      )[]
    | undefined;
};

export type TraceFilter<
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  type: "trace";
  chainId: number;
  fromAddress: FilterAddress<fromFactory>;
  toAddress: FilterAddress<toFactory>;
  functionSelector: Hex | Hex[] | undefined;
  callType: Trace["result"]["type"] | undefined;
  includeReverted: boolean;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  include:
    | (
        | `block.${keyof Block}`
        | `transaction.${keyof Transaction}`
        | `transactionReceipt.${keyof TransactionReceipt}`
        | `trace.${keyof UserTrace}`
      )[]
    | undefined;
};

export type LogFactory = {
  type: "log";
  chainId: number;
  address: Address | Address[];
  eventSelector: Hex;
  childAddressLocation: "topic1" | "topic2" | "topic3" | `offset${number}`;
};

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
