import type { Abi, Address, Hex, LogTopic } from "viem";
import type { AbiEvents } from "./abi.js";

export type LogFilterCriteria = {
  address?: Address | Address[];
  topics: LogTopic[];
  includeTransactionReceipts: boolean;
};

export type FactoryCriteria = {
  address: Address;
  eventSelector: Hex;
  childAddressLocation: "topic1" | "topic2" | "topic3" | `offset${number}`;
  topics: LogTopic[];
  includeTransactionReceipts: boolean;
};

export type BlockFilterCriteria = {
  frequency: number;
  offset: number;
};

type BaseLogSource = {
  id: string;
  contractName: string;
  networkName: string;
  chainId: number;
  abi: Abi;
  abiEvents: AbiEvents;
  startBlock: number;
  endBlock?: number;
  maxBlockRange?: number;
};

export type LogSource = BaseLogSource & {
  type: "log";
  criteria: LogFilterCriteria;
};

export type FactorySource = BaseLogSource & {
  type: "factory";
  criteria: FactoryCriteria;
};

export type BlockSource = {
  type: "block";
  id: string;
  sourceName: string;
  networkName: string;
  chainId: number;
  startBlock: number;
  endBlock?: number;
  criteria: BlockFilterCriteria;
};

export type EventSource = LogSource | FactorySource | BlockSource;

export const sourceIsLog = (
  source: Pick<EventSource, "type">,
): source is LogSource => source.type === "log";

export const sourceIsFactory = (
  source: Pick<EventSource, "type">,
): source is FactorySource => source.type === "factory";

export const sourceIsBlock = (
  source: Pick<EventSource, "type">,
): source is BlockSource => source.type === "block";
