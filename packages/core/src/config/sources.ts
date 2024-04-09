import type { Abi, Address, Hex, LogTopic } from "viem";
import type { AbiEvents } from "./abi.js";

export type LogFilterCriteria = {
  address?: Address | Address[];
  topics?: LogTopic[];
};

export type FactoryCriteria = {
  address: Address;
  eventSelector: Hex;
  childAddressLocation: "topic1" | "topic2" | "topic3" | `offset${number}`;
  topics?: LogTopic[];
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

export type LogFilter = BaseSource & {
  type: "logFilter";
  criteria: LogFilterCriteria;
};

export type Factory = BaseSource & {
  type: "factory";
  criteria: FactoryCriteria;
};

export type Source = LogFilter | Factory;

export const sourceIsLogFilter = (
  source: Pick<Source, "type">,
): source is LogFilter => source.type === "logFilter";

export const sourceIsFactory = (
  source: Pick<Source, "type">,
): source is Factory => source.type === "factory";
