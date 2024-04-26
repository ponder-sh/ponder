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

type BaseSource = {
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

export type LogSource = BaseSource & {
  type: "log";
  criteria: LogFilterCriteria;
};

export type FactorySource = BaseSource & {
  type: "factory";
  criteria: FactoryCriteria;
};

export type EventSource = LogSource | FactorySource;

export const sourceIsLog = (
  source: Pick<EventSource, "type">,
): source is LogSource => source.type === "log";

export const sourceIsFactory = (
  source: Pick<EventSource, "type">,
): source is FactorySource => source.type === "factory";
