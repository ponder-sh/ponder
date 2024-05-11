import type { Abi, Address, Hex, LogTopic } from "viem";
import type { AbiEvents, AbiFunctions } from "./abi.js";

/**
 * Fix issue with Array.isArray not checking readonly arrays
 * {@link https://github.com/microsoft/TypeScript/issues/17002}
 */
declare global {
  interface ArrayConstructor {
    isArray(arg: ReadonlyArray<any> | any): arg is ReadonlyArray<any>;
  }
}

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
  interval: number;
  offset: number;
};

export type CallTraceFilterCriteria = {
  fromAddress?: Address[];
  toAddress?: Address[];
  includeTransactionReceipts: boolean;
  functionSelectors: Hex[];
};

type BaseLogSource = {
  /** `log_${contractName}_${networkName}` */
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
  /** `block_${sourceName}_${networkName}` */
  id: string;
  sourceName: string;
  networkName: string;
  chainId: number;
  startBlock: number;
  endBlock?: number;
  criteria: BlockFilterCriteria;
};

export type CallTraceSource = {
  type: "callTrace";
  /** `callTrace_${contractName}_${networkName}` */
  id: string;
  contractName: string;
  networkName: string;
  chainId: number;
  abi: Abi;
  abiFunctions: AbiFunctions;
  startBlock: number;
  endBlock?: number;
  maxBlockRange?: number;
  criteria: CallTraceFilterCriteria;
};

export type EventSource =
  | LogSource
  | FactorySource
  | BlockSource
  | CallTraceSource;

export const sourceIsLog = (
  source: Pick<EventSource, "type">,
): source is LogSource => source.type === "log";

export const sourceIsFactory = (
  source: Pick<EventSource, "type">,
): source is FactorySource => source.type === "factory";

export const sourceIsBlock = (
  source: Pick<EventSource, "type">,
): source is BlockSource => source.type === "block";

export const sourceIsCallTrace = (
  source: Pick<EventSource, "type">,
): source is CallTraceSource => source.type === "callTrace";
