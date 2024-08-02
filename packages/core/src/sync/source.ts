import type { SyncCallTrace, SyncLog } from "@/types/sync.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { Abi, Address, Hex, LogTopic } from "viem";

type ContractMetadata = {
  type: "contract";
  abi: Abi;
  name: string;
  networkName: string;
};
type BlockMetadata = {
  type: "block";
  name: string;
  networkName: string;
};

export type ContractSource = { filter: LogFilter } & ContractMetadata;
export type BlockSource = { filter: BlockFilter } & BlockMetadata;
export type Source = ContractSource | BlockSource;

// TODO(kyle) includeTransactionReceipt

export type LogFilter = {
  type: "log";
  chainId: number;
  address?: Address | Address[] | AddressFilter;
  topics?: LogTopic[];
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

export type LogAddressFilter = {
  type: "log";
  chainId: number;
  address: Address;
  eventSelector: Hex;
  childAddressLocation: "topic1" | "topic2" | "topic3" | `offset${number}`;
};

export type Filter = LogFilter | BlockFilter;

export type AddressFilter = LogAddressFilter;

/** Returns true if `address` is an address filter. */
export const isAddressFilter = (
  address: (LogFilter | LogAddressFilter)["address"] | null,
): address is LogAddressFilter => {
  if (address === undefined || address === null) return false;
  return typeof address !== "string" && Array.isArray(address) === false;
};

// TODO(kyle) consider start and end block
// TODO(kyle) normalize logs before
export function isLogFilterMatched({
  log,
  filter,
}: { log: SyncLog; filter: LogFilter }) {
  const logAddress = toLowerCase(log.address);

  if (filter.address !== undefined && filter.address.length > 0) {
    if (Array.isArray(filter.address)) {
      if (!filter.address.includes(logAddress)) return false;
    } else {
      if (logAddress !== filter.address) return false;
    }
  }

  if (filter.topics) {
    for (const [index, topic] of filter.topics.entries()) {
      if (topic === null || topic === undefined) continue;

      if (log.topics[index] === null || log.topics[index] === undefined)
        return false;

      if (Array.isArray(topic)) {
        if (!topic.includes(toLowerCase(log.topics[index]!))) return false;
      } else {
        if (toLowerCase(log.topics[index]!) !== topic) return false;
      }
    }
  }

  return true;
}

export function isCallTraceFilterMatched({
  callTrace,
  filter,
}: {
  callTrace: SyncCallTrace;
  // @ts-ignore
  filter: CallTraceFilter;
}) {
  const fromAddress = toLowerCase(callTrace.action.from);
  const toAddress = toLowerCase(callTrace.action.to);

  if (filter.fromAddress !== undefined && filter.fromAddress.length > 0) {
    if (filter.fromAddress.includes(fromAddress) === false) return false;
  }

  if (filter.toAddress !== undefined && filter.toAddress.length > 0) {
    if (filter.toAddress.includes(toAddress) === false) return false;
  }

  return true;
}
