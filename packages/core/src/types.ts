import NodeEventEmitter from "node:events";
import TypedEmitter, { EventMap } from "typed-emitter";

import type { Ponder } from "@/Ponder";

// --------------------------- PLUGIN TYPES --------------------------- //

export interface PonderPlugin {
  name: string;

  setup?: () => Promise<void>;
  reload?: () => Promise<void>;
  teardown?: () => Promise<void>;
}

export type PonderPluginBuilder<PluginOptions = Record<string, unknown>> = (
  options?: PluginOptions
) => (ponder: Ponder) => PonderPlugin;

// --------------------------- EVENT EMITTER TYPES --------------------------- //

export class EventEmitter<T extends EventMap> extends (NodeEventEmitter as {
  new <T extends EventMap>(): TypedEmitter<T>;
})<T> {}

export type PonderEvents = {
  dev_error: (arg: { context: string; error?: Error }) => void;

  backfill_networkConnected: (arg: {
    network: string;
    blockNumber: number;
    blockTimestamp: number;
  }) => void;
  backfill_sourceStarted: (arg: { source: string; cacheRate: number }) => void;
  backfill_logTasksAdded: (arg: { source: string; taskCount: number }) => void;
  backfill_blockTasksAdded: (arg: {
    source: string;
    taskCount: number;
  }) => void;
  backfill_logTaskFailed: (arg: { source: string; error: Error }) => void;
  backfill_blockTaskFailed: (arg: { source: string; error: Error }) => void;
  backfill_logTaskDone: (arg: { source: string }) => void;
  backfill_blockTaskDone: (arg: { source: string }) => void;
  backfill_newLogs: () => void;

  frontfill_taskFailed: (arg: { network: string; error: Error }) => void;
  frontfill_newLogs: (arg: {
    network: string;
    blockNumber: number;
    blockTimestamp: number;
    blockTxnCount: number;
    matchedLogCount: number;
  }) => void;

  indexer_taskStarted: () => void;
  indexer_taskDone: (arg: { timestamp: number }) => void;
};

// --------------------------- BLOCKCHAIN DATA TYPES --------------------------- //

export interface Block {
  hash: string;
  number: number;
  timestamp: number;

  gasLimit: string; // BigNumber
  gasUsed: string; // BigNumber
  baseFeePerGas: string; // BigNumber

  miner: string;
  extraData: string;
  size: number;

  parentHash: string;
  stateRoot: string;
  transactionsRoot: string;
  receiptsRoot: string;
  logsBloom: string;
  totalDifficulty: string; // BigNumber
}

export interface Transaction {
  hash: string;
  nonce: number;

  from: string;
  to?: string; // null if contract creation
  value: string; // BigNumber
  input: string;

  gas: string; // BigNumber
  gasPrice: string; // BigNumber
  maxFeePerGas?: string; // BigNumber
  maxPriorityFeePerGas?: string; // BigNumber

  blockHash: string;
  blockNumber: number;
  transactionIndex: number;
  chainId: number;
}

export interface Log {
  logId: string; // `${log.blockHash}-${log.logIndex}`
  logSortKey: number;

  address: string;
  data: string;
  topics: string; // JSON.stringify-ed array of topic strings

  blockHash: string;
  blockNumber: number;
  logIndex: number;

  transactionHash: string;
  transactionIndex: number;

  removed: number; // boolean, 0 or 1
}
