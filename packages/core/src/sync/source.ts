import type { AbiEvents, AbiFunctions } from "@/sync/abi.js";
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
  maxBlockRange?: number;
};
export type BlockMetadata = {
  type: "block";
  name: string;
  networkName: string;
};

export type LogFilter<
  factory extends Factory | Factory[] | undefined =
    | Factory
    | Factory[]
    | undefined,
> = {
  type: "log";
  chainId: number;
  address: factory extends Factory | Factory[]
    ? factory
    : Address | Address[] | undefined;
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
  factory extends Factory | Factory[] | undefined =
    | Factory
    | Factory[]
    | undefined,
> = {
  type: "callTrace";
  chainId: number;
  fromAddress: Address[] | undefined;
  toAddress: factory extends Factory | Factory[]
    ? factory
    : Address[] | undefined;
  functionSelectors: Hex[];
  includeTransactionReceipts: boolean;
  fromBlock: number;
  toBlock: number | undefined;
};

export type LogFactory = {
  type: "log";
  chainId: number;
  address: Address;
  eventSelector: Hex;
  childAddressLocation: "topic1" | "topic2" | "topic3" | `offset${number}`;
};

/** Returns true if `address` is an address filter. */
export const isAddressFactory = (
  address: Address | Address[] | Factory | Factory[] | undefined | null,
): address is LogFactory | LogFactory[] => {
  if (address === undefined || address === null || typeof address === "string")
    return false;
  return Array.isArray(address) ? isAddressFactory(address[0]) : true;
};
