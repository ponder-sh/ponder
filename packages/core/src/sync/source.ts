import type { Abi, Address, Hex, LogTopic } from "viem";
// import type { AbiEvents, AbiFunctions } from "../config/abi.js";

export type Source = ContractSource | BlockSource;
export type ContractSource = {
  filter: LogFilter | CallTraceFilter;
} & ContractMetadata;
export type BlockSource = { filter: BlockFilter } & BlockMetadata;

export type Filter = LogFilter | BlockFilter | CallTraceFilter;
export type AddressFilter = LogAddressFilter;

type ContractMetadata = {
  type: "contract";
  abi: Abi;
  name: string;
  networkName: string;
  maxBlockRange?: number;
};
type BlockMetadata = {
  type: "block";
  name: string;
  networkName: string;
};

export type LogFilter = {
  type: "log";
  chainId: number;
  address?: Address | Address[] | AddressFilter;
  topics: LogTopic[];
  includeTransactionReceipts: boolean;
  fromBlock: number;
  toBlock?: number;
};

export type BlockFilter = {
  type: "block";
  chainId: number;
  interval: number;
  offset: number;
  fromBlock: number;
  toBlock?: number;
};

export type CallTraceFilter = {
  type: "callTrace";
  chainId: number;
  fromAddress?: Address[];
  toAddress?: Address[] | AddressFilter;
  functionSelectors: Hex[];
  includeTransactionReceipts: boolean;
  fromBlock: number;
  toBlock?: number;
};

export type LogAddressFilter = {
  type: "log";
  chainId: number;
  address: Address;
  eventSelector: Hex;
  childAddressLocation: "topic1" | "topic2" | "topic3" | `offset${number}`;
};

/** Returns true if `address` is an address filter. */
export const isAddressFilter = (
  address: (LogFilter | LogAddressFilter)["address"] | null,
): address is LogAddressFilter => {
  if (address === undefined || address === null) return false;
  return typeof address !== "string" && Array.isArray(address) === false;
};

////////

// export type ChildAddressCriteria = {
//   address: Address;
//   eventSelector: Hex;
//   childAddressLocation: "topic1" | "topic2" | "topic3" | `offset${number}`;
// };

// export type LogFilterCriteria = {
//   address?: Address | Address[];
//   topics: LogTopic[];
//   includeTransactionReceipts: boolean;
// };

// export type FactoryLogFilterCriteria = ChildAddressCriteria & {
//   topics: LogTopic[];
//   includeTransactionReceipts: boolean;
// };

// export type BlockFilterCriteria = {
//   interval: number;
//   offset: number;
// };

// export type CallTraceFilterCriteria = {
//   fromAddress?: Address[];
//   toAddress?: Address[];
//   includeTransactionReceipts: boolean;
//   functionSelectors: Hex[];
// };

// export type FactoryCallTraceFilterCriteria = ChildAddressCriteria & {
//   fromAddress?: Address[];
//   includeTransactionReceipts: boolean;
//   functionSelectors: Hex[];
// };

// export type LogSource = {
//   type: "log";
//   /** `log_${contractName}_${networkName}` */
//   id: string;
//   criteria: LogFilterCriteria;
//   contractName: string;
//   networkName: string;
//   chainId: number;
//   abi: Abi;
//   abiEvents: AbiEvents;
//   startBlock: number;
//   endBlock?: number;
//   maxBlockRange?: number;
// };

// export type FactoryLogSource = {
//   type: "factoryLog";
//   /** `log_${contractName}_${networkName}` */
//   id: string;
//   criteria: FactoryLogFilterCriteria;
//   contractName: string;
//   networkName: string;
//   chainId: number;
//   abi: Abi;
//   abiEvents: AbiEvents;
//   startBlock: number;
//   endBlock?: number;
//   maxBlockRange?: number;
// };

// export type BlockSource = {
//   type: "block";
//   /** `block_${sourceName}_${networkName}` */
//   id: string;
//   criteria: BlockFilterCriteria;
//   sourceName: string;
//   networkName: string;
//   chainId: number;
//   startBlock: number;
//   endBlock?: number;
// };

// export type CallTraceSource = {
//   type: "callTrace";
//   /** `callTrace_${contractName}_${networkName}` */
//   id: string;
//   criteria: CallTraceFilterCriteria;
//   contractName: string;
//   networkName: string;
//   chainId: number;
//   abi: Abi;
//   abiFunctions: AbiFunctions;
//   startBlock: number;
//   endBlock?: number;
//   maxBlockRange?: number;
// };

// export type FactoryCallTraceSource = {
//   type: "factoryCallTrace";
//   /** `callTrace_${contractName}_${networkName}` */
//   id: string;
//   criteria: FactoryCallTraceFilterCriteria;
//   contractName: string;
//   networkName: string;
//   chainId: number;
//   abi: Abi;
//   abiFunctions: AbiFunctions;
//   startBlock: number;
//   endBlock?: number;
//   maxBlockRange?: number;
// };

// export type EventSource =
//   | LogSource
//   | FactoryLogSource
//   | CallTraceSource
//   | FactoryCallTraceSource
//   | BlockSource;

// export const sourceIsLog = (
//   source: Pick<EventSource, "type">,
// ): source is LogSource => source.type === "log";

// export const sourceIsFactoryLog = (
//   source: Pick<EventSource, "type">,
// ): source is FactoryLogSource => source.type === "factoryLog";

// export const sourceIsCallTrace = (
//   source: Pick<EventSource, "type">,
// ): source is CallTraceSource => source.type === "callTrace";

// export const sourceIsFactoryCallTrace = (
//   source: Pick<EventSource, "type">,
// ): source is FactoryCallTraceSource => source.type === "factoryCallTrace";

// export const sourceIsBlock = (
//   source: Pick<EventSource, "type">,
// ): source is BlockSource => source.type === "block";
