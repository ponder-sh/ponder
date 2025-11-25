import type { SqlStatements } from "@/drizzle/kit/index.js";
import type { Rpc } from "@/rpc/index.js";
import type {
  Block,
  Log,
  Trace,
  Transaction,
  TransactionReceipt,
  Transfer,
} from "@/types/eth.js";
import type { PartialExcept, Prettify } from "@/types/utils.js";
import type { Trace as DebugTrace } from "@/utils/debug.js";
import type { PGliteOptions } from "@/utils/pglite.js";
import type { PGlite } from "@electric-sql/pglite";
import type { Hono } from "hono";
import type { PoolConfig } from "pg";
import type {
  Abi,
  AbiEvent,
  AbiFunction,
  Address,
  BlockTag,
  Hex,
  LogTopic,
  RpcBlock,
  RpcTransaction,
  RpcTransactionReceipt,
  Transport,
  Chain as ViemChain,
  Log as ViemLog,
} from "viem";
import type { RetryableError } from "./errors.js";

// Database

export type DatabaseConfig =
  | { kind: "pglite"; options: PGliteOptions }
  | { kind: "pglite_test"; instance: PGlite }
  | { kind: "postgres"; poolConfig: Prettify<PoolConfig & { max: number }> };

// Indexing

/** Indexing functions as defined in `ponder.on()` */
export type IndexingFunctions = {
  /** Name of the event */
  name: string;
  /** Callback function */
  fn: (...args: any) => any;
}[];

// Filters

/** Filter definition based on the fundamental data model of the Ethereum blockchain. */
export type Filter =
  | LogFilter
  | BlockFilter
  | TransferFilter
  | TransactionFilter
  | TraceFilter;

/**
 * Filter that matches addresses.
 *
 * @dev This object is used as a unique constraint in the `ponder_sync.factories` table.
 * Any changes to the type must be backwards compatible and probably requires updating
 * `syncStore.getChildAddresses` and `syncStore.insertChildAddresses`.
 */
export type Factory = LogFactory;
export type FilterAddress<
  factory extends Factory | undefined = Factory | undefined,
> = factory extends Factory ? factory : Address | Address[] | undefined;

export type BlockFilter = {
  type: "block";
  chainId: number;
  sourceId: string;
  interval: number;
  offset: number;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  hasTransactionReceipt: false;
  include: `block.${keyof Block}`[];
};

export type TransactionFilter<
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  type: "transaction";
  chainId: number;
  sourceId: string;
  fromAddress: FilterAddress<fromFactory>;
  toAddress: FilterAddress<toFactory>;
  includeReverted: boolean;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  hasTransactionReceipt: true;
  include: (
    | `block.${keyof Block}`
    | `transaction.${keyof Transaction}`
    | `transactionReceipt.${keyof TransactionReceipt}`
  )[];
};

export type TraceFilter<
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  type: "trace";
  chainId: number;
  sourceId: string;
  fromAddress: FilterAddress<fromFactory>;
  toAddress: FilterAddress<toFactory>;
  functionSelector: Hex;
  callType: Trace["type"] | undefined;
  includeReverted: boolean;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  hasTransactionReceipt: boolean;
  include: (
    | `block.${keyof Block}`
    | `transaction.${keyof Transaction}`
    | `transactionReceipt.${keyof TransactionReceipt}`
    | `trace.${keyof Trace}`
  )[];
};

export type LogFilter<
  factory extends Factory | undefined = Factory | undefined,
> = {
  type: "log";
  chainId: number;
  sourceId: string;
  address: FilterAddress<factory>;
  topic0: Hex;
  topic1: LogTopic;
  topic2: LogTopic;
  topic3: LogTopic;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  hasTransactionReceipt: boolean;
  include: (
    | `block.${keyof Block}`
    | `transaction.${keyof Transaction}`
    | `transactionReceipt.${keyof TransactionReceipt}`
    | `log.${keyof Log}`
  )[];
};

export type TransferFilter<
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  type: "transfer";
  chainId: number;
  sourceId: string;
  fromAddress: FilterAddress<fromFactory>;
  toAddress: FilterAddress<toFactory>;
  includeReverted: boolean;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  hasTransactionReceipt: boolean;
  include: (
    | `block.${keyof Block}`
    | `transaction.${keyof Transaction}`
    | `transactionReceipt.${keyof TransactionReceipt}`
    | `trace.${keyof Trace}`
  )[];
};

export type FactoryId = string;

export type LogFactory = {
  id: FactoryId;
  type: "log";
  chainId: number;
  sourceId: string;
  address: Address | Address[] | undefined;
  eventSelector: Hex;
  childAddressLocation: "topic1" | "topic2" | "topic3" | `offset${number}`;
  fromBlock: number | undefined;
  toBlock: number | undefined;
};

// Fragments

export type FragmentAddress =
  | Address
  | {
      address: Address | null;
      eventSelector: Factory["eventSelector"];
      childAddressLocation: Factory["childAddressLocation"];
    }
  | null;

export type FragmentAddressId =
  | Address
  | `${Address | null}_${Factory["eventSelector"]}_${Factory["childAddressLocation"]}`
  | null;
export type FragmentTopic = Hex | null;

export type Fragment =
  | {
      type: "block";
      chainId: number;
      interval: number;
      offset: number;
    }
  | {
      type: "transaction";
      chainId: number;
      fromAddress: FragmentAddress;
      toAddress: FragmentAddress;
    }
  | {
      type: "trace";
      chainId: number;
      fromAddress: FragmentAddress;
      toAddress: FragmentAddress;
      functionSelector: Hex;
      includeTransactionReceipts: boolean;
    }
  | {
      type: "log";
      chainId: number;
      address: FragmentAddress;
      topic0: Hex;
      topic1: FragmentTopic;
      topic2: FragmentTopic;
      topic3: FragmentTopic;
      includeTransactionReceipts: boolean;
    }
  | {
      type: "transfer";
      chainId: number;
      fromAddress: FragmentAddress;
      toAddress: FragmentAddress;
      includeTransactionReceipts: boolean;
    }
  | {
      type: "factory_log";
      chainId: number;
      address: Address | null;
      eventSelector: Factory["eventSelector"];
      childAddressLocation: Factory["childAddressLocation"];
      fromBlock: number | null;
      toBlock: number | null;
    };

/** Minimum slice of a {@link Filter} */
export type FragmentId =
  /** block_{chainId}_{interval}_{offset} */
  | `block_${number}_${number}_${number}`
  /** transaction_{chainId}_{fromAddress}_{toAddress} */
  | `transaction_${number}_${FragmentAddressId}_${FragmentAddressId}`
  /** trace_{chainId}_{fromAddress}_{toAddress}_{functionSelector}_{includeReceipts} */
  | `trace_${number}_${FragmentAddressId}_${FragmentAddressId}_${Hex | null}_${0 | 1}`
  /** log_{chainId}_{address}_{topic0}_{topic1}_{topic2}_{topic3}_{includeReceipts} */
  | `log_${number}_${FragmentAddressId}_${FragmentTopic}_${FragmentTopic}_${FragmentTopic}_${FragmentTopic}_${0 | 1}`
  /** transfer_{chainId}_{fromAddress}_{toAddress}_{includeReceipts} */
  | `transfer_${number}_${FragmentAddressId}_${FragmentAddressId}_${0 | 1}`
  /** factory_log_{chainId}_{address}_{eventSelector}_{childAddressLocation}_{fromBlock}_{toBlock} */
  | `factory_log_${number}_${Address | null}_${Factory["eventSelector"]}_${Factory["childAddressLocation"]}_${number | null}_${number | null}`;

// Contract
export type Contract = {
  abi: Abi;
  address?: Address | readonly Address[];
  startBlock?: number;
  endBlock?: number;
};

// Event Callback

export type EventCallback = {
  filter: Filter;
  name: string;
  fn: (...args: any) => any;
  chain: Chain;
} & (
  | {
      type: "contract";
      abiItem: AbiEvent | AbiFunction;
      metadata: { safeName: string; abi: Abi };
    }
  | { type: "account"; direction: "from" | "to" }
  | { type: "block" }
);

export type SetupCallback = {
  name: string;
  fn: (...args: any) => any;
  chain: Chain;
  block: number | undefined;
};

// Chain

export type Chain = {
  name: string;
  id: number;
  rpc: string | string[] | Transport;
  ws: string | undefined;
  pollingInterval: number;
  finalityBlockCount: number;
  disableCache: boolean;
  ethGetLogsBlockRange: number | undefined;
  viemChain: ViemChain | undefined;
};

// Schema

/** User-defined tables, enums, and indexes. */
export type Schema = { [name: string]: unknown };

// Build artifacts

/** Database schema name. */
export type NamespaceBuild = {
  schema: string;
  viewsSchema: string | undefined;
};

/** Consolidated CLI, env vars, and config. */
export type PreBuild = {
  /** Database type and configuration */
  databaseConfig: DatabaseConfig;
  /** Ordering of events */
  ordering: "omnichain" | "multichain" | "experimental_isolated";
};

export type SchemaBuild = {
  schema: Schema;
  /** SQL statements to create the schema */
  statements: SqlStatements;
};

export type IndexingBuild = {
  /** Ten character hex string identifier. */
  buildId: string;
  /** Chains to index. */
  chains: Chain[];
  /** RPCs for all `chains`. */
  rpcs: Rpc[];
  /** Finalized blocks for all `chains`. */
  finalizedBlocks: LightBlock[];
  /** Event callbacks for all `chains`.  */
  eventCallbacks: EventCallback[][];
  /** Setup callbacks for all `chains`. */
  setupCallbacks: SetupCallback[][];
  /** Indexing functions registered with `ponder.on()`. */
  indexingFunctions: IndexingFunctions;
  /** Contracts for all `chains`. */
  contracts: {
    [name: string]: Contract;
  }[];
};

export type ApiBuild = {
  /** Hostname for server */
  hostname?: string;
  /** Port number for server */
  port: number;
  /** Hono app exported from `ponder/api/index.ts`. */
  app: Hono;
};

// Crash recovery

/**
 * @dev It is not an invariant that `chainId` and `checkpoint.chainId` are the same.
 */
export type CrashRecoveryCheckpoint =
  | {
      chainId: number;
      checkpoint: string;
    }[]
  | undefined;

// Status

export type Status = {
  [chainName: string]: {
    id: number;
    block: { number: number; timestamp: number };
  };
};

// Indexing error handler

export type IndexingErrorHandler = {
  getRetryableError: () => RetryableError | undefined;
  setRetryableError: (error: RetryableError) => void;
  clearRetryableError: () => void;
  error: RetryableError | undefined;
};

// Seconds

export type Seconds = {
  [chain: string]: { start: number; end: number; cached: number };
};

// Blockchain data

export type SyncBlock = Prettify<RpcBlock<Exclude<BlockTag, "pending">, true>>;
export type SyncBlockHeader = Omit<SyncBlock, "transactions"> & {
  transactions: undefined;
};
export type SyncTransaction = RpcTransaction<false>;
export type SyncTransactionReceipt = RpcTransactionReceipt;
export type SyncTrace = {
  trace: DebugTrace["result"] & { index: number; subcalls: number };
  transactionHash: DebugTrace["txHash"];
};
export type SyncLog = ViemLog<Hex, Hex, false>;

export type LightBlock = Pick<
  SyncBlock,
  "hash" | "parentHash" | "number" | "timestamp"
>;

export type RequiredBlockColumns = "timestamp" | "number" | "hash";
export type RequiredTransactionColumns =
  | "transactionIndex"
  | "from"
  | "to"
  | "hash"
  | "type";
export type RequiredTransactionReceiptColumns = "status" | "from" | "to";
export type RequiredTraceColumns =
  | "from"
  | "to"
  | "input"
  | "output"
  | "value"
  | "type"
  | "error"
  | "traceIndex";
export type RequiredLogColumns = keyof Log;

export type RequiredInternalBlockColumns = RequiredBlockColumns;
export type RequiredInternalTransactionColumns =
  | RequiredTransactionColumns
  | "blockNumber";
export type RequiredInternalTransactionReceiptColumns =
  | RequiredTransactionReceiptColumns
  | "blockNumber"
  | "transactionIndex";
export type RequiredInternalTraceColumns =
  | RequiredTraceColumns
  | "blockNumber"
  | "transactionIndex";
export type RequiredInternalLogColumns =
  | RequiredLogColumns
  | "blockNumber"
  | "transactionIndex";

export type InternalBlock = PartialExcept<Block, RequiredBlockColumns>;
export type InternalTransaction = PartialExcept<
  Transaction,
  RequiredTransactionColumns
> & {
  blockNumber: number;
};
export type InternalTransactionReceipt = PartialExcept<
  TransactionReceipt,
  RequiredTransactionReceiptColumns
> & {
  blockNumber: number;
  transactionIndex: number;
};
export type InternalTrace = PartialExcept<Trace, RequiredTraceColumns> & {
  blockNumber: number;
  transactionIndex: number;
};
export type InternalLog = Log & {
  blockNumber: number;
  transactionIndex: number;
};

export type UserBlock = PartialExcept<Block, RequiredBlockColumns>;
export type UserTransaction = PartialExcept<
  Transaction,
  RequiredTransactionColumns
>;
export type UserTransactionReceipt = PartialExcept<
  TransactionReceipt,
  RequiredTransactionReceiptColumns
>;
export type UserTrace = PartialExcept<Trace, RequiredTraceColumns>;
export type UserLog = Log;

// Events

export type RawEvent = {
  checkpoint: string;
  chainId: number;
  eventCallbackIndex: number;
  log?: UserLog;
  block: UserBlock;
  transaction?: UserTransaction;
  transactionReceipt?: UserTransactionReceipt;
  trace?: UserTrace;
};

export type Event =
  | BlockEvent
  | TransactionEvent
  | TraceEvent
  | LogEvent
  | TransferEvent;

export type SetupEvent = {
  type: "setup";
  checkpoint: string;
  chain: Chain;
  setupCallback: SetupCallback;

  block: bigint;
};

export type BlockEvent = {
  type: "block";
  checkpoint: string;
  chain: Chain;
  eventCallback: EventCallback;

  event: {
    id: string;
    block: UserBlock;
  };
};

export type TransactionEvent = {
  type: "transaction";
  checkpoint: string;
  chain: Chain;
  eventCallback: EventCallback;

  event: {
    id: string;
    block: UserBlock;
    transaction: UserTransaction;
    transactionReceipt?: UserTransactionReceipt;
  };
};

export type TraceEvent = {
  type: "trace";
  checkpoint: string;
  chain: Chain;
  eventCallback: EventCallback;

  event: {
    id: string;
    args: { [key: string]: unknown } | readonly unknown[] | undefined;
    result: { [key: string]: unknown } | readonly unknown[] | undefined;
    block: UserBlock;
    transaction: UserTransaction;
    transactionReceipt?: UserTransactionReceipt;
    trace: UserTrace;
  };
};

export type LogEvent = {
  type: "log";
  checkpoint: string;
  chain: Chain;
  eventCallback: EventCallback;

  event: {
    id: string;
    args: { [key: string]: unknown } | readonly unknown[] | undefined;
    block: UserBlock;
    transaction: UserTransaction;
    transactionReceipt?: UserTransactionReceipt;
    log: UserLog;
  };
};

export type TransferEvent = {
  type: "transfer";
  checkpoint: string;
  chain: Chain;
  eventCallback: EventCallback;

  event: {
    id: string;
    transfer: Transfer;
    block: UserBlock;
    transaction: UserTransaction;
    transactionReceipt?: UserTransactionReceipt;
    trace: UserTrace;
  };
};
