import type { AbiEvents, AbiFunctions } from "@/sync/abi.js";
import type { SyncLog } from "@/types/sync.js";
import type { Abi, Address, Hex, LogTopic } from "viem";

export type Source = ContractSource | BlockSource;
export type ContractSource<
  filter extends "log" | "trace" = "log" | "trace",
  factory extends Factory | undefined = Factory | undefined,
> = {
  filter: filter extends "log" ? LogFilter<factory> : CallTraceFilter<factory>;
} & ContractMetadata;
export type BlockSource = { filter: BlockFilter } & BlockMetadata;

export type Filter = LogFilter | BlockFilter | CallTraceFilter;
export type Factory = LogFactory;

export type ContractMetadata = {
  type: "contract";
  abi: Abi;
  abiEvents: AbiEvents;
  abiFunctions: AbiFunctions;
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
  address: factory extends Factory ? factory : Address | Address[] | undefined;
  topics: LogTopic[];
  includeTransactionReceipts: boolean;
  fromBlock: number;
  toBlock: number | undefined;
};

export type BlockFilter = {
  type: "block";
  chainId: number;
  interval: number;
  offset: number;
  fromBlock: number;
  toBlock: number | undefined;
};

export type CallTraceFilter<
  factory extends Factory | undefined = Factory | undefined,
> = {
  type: "callTrace";
  chainId: number;
  fromAddress: Address[] | undefined;
  toAddress: factory extends Factory ? factory : Address[] | undefined;
  functionSelectors: Hex[];
  includeTransactionReceipts: boolean;
  fromBlock: number;
  toBlock: number | undefined;
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
