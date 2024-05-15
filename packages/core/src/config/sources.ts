import type { Abi, Address, Hex, LogTopic } from "viem";
import type { AbiEvents, AbiFunctions } from "./abi.js";

export type ChildAddressCriteria = {
  address: Address;
  eventSelector: Hex;
  childAddressLocation: "topic1" | "topic2" | "topic3" | `offset${number}`;
};

export type LogFilterCriteria = {
  address?: Address | Address[];
  topics: LogTopic[];
  includeTransactionReceipts: boolean;
};

export type FactoryLogFilterCriteria = ChildAddressCriteria & {
  topics: LogTopic[];
  includeTransactionReceipts: boolean;
};

export type BlockFilterCriteria = {
  interval: number;
  offset: number;
};

export type CallTraceFilterCriteria = {
  fromAddress?: Address[];
  toAddress?: Address[];
  includeTransactionReceipts: boolean;
  functionSelectors: Hex[];
};

export type FactoryCallTraceFilterCriteria = ChildAddressCriteria & {
  fromAddress?: Address[];
  includeTransactionReceipts: boolean;
  functionSelectors: Hex[];
};

export type LogSource = {
  type: "log";
  /** `log_${contractName}_${networkName}` */
  id: string;
  criteria: LogFilterCriteria;
  contractName: string;
  networkName: string;
  chainId: number;
  abi: Abi;
  abiEvents: AbiEvents;
  startBlock: number;
  endBlock?: number;
  maxBlockRange?: number;
};

export type FactoryLogSource = {
  type: "factoryLog";
  /** `log_${contractName}_${networkName}` */
  id: string;
  criteria: FactoryLogFilterCriteria;
  contractName: string;
  networkName: string;
  chainId: number;
  abi: Abi;
  abiEvents: AbiEvents;
  startBlock: number;
  endBlock?: number;
  maxBlockRange?: number;
};

export type BlockSource = {
  type: "block";
  /** `block_${sourceName}_${networkName}` */
  id: string;
  criteria: BlockFilterCriteria;
  sourceName: string;
  networkName: string;
  chainId: number;
  startBlock: number;
  endBlock?: number;
};

export type CallTraceSource = {
  type: "callTrace";
  /** `callTrace_${contractName}_${networkName}` */
  id: string;
  criteria: CallTraceFilterCriteria;
  contractName: string;
  networkName: string;
  chainId: number;
  abi: Abi;
  abiFunctions: AbiFunctions;
  startBlock: number;
  endBlock?: number;
  maxBlockRange?: number;
};

export type FactoryCallTraceSource = {
  type: "factoryCallTrace";
  /** `callTrace_${contractName}_${networkName}` */
  id: string;
  criteria: FactoryCallTraceFilterCriteria;
  contractName: string;
  networkName: string;
  chainId: number;
  abi: Abi;
  abiFunctions: AbiFunctions;
  startBlock: number;
  endBlock?: number;
  maxBlockRange?: number;
};

export type EventSource =
  | LogSource
  | FactoryLogSource
  | CallTraceSource
  | FactoryCallTraceSource
  | BlockSource;

export const sourceIsLog = (
  source: Pick<EventSource, "type">,
): source is LogSource => source.type === "log";

export const sourceIsFactoryLog = (
  source: Pick<EventSource, "type">,
): source is FactoryLogSource => source.type === "factoryLog";

export const sourceIsCallTrace = (
  source: Pick<EventSource, "type">,
): source is CallTraceSource => source.type === "callTrace";

export const sourceIsFactoryCallTrace = (
  source: Pick<EventSource, "type">,
): source is FactoryCallTraceSource => source.type === "factoryCallTrace";

export const sourceIsBlock = (
  source: Pick<EventSource, "type">,
): source is BlockSource => source.type === "block";
