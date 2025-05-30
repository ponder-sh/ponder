import type { SqlStatements } from "@/drizzle/kit/index.js";
import type { Rpc } from "@/rpc/index.js";
import type { AbiEvents, AbiFunctions } from "@/sync/abi.js";
import type {
  Block,
  Log,
  Trace,
  Transaction,
  TransactionReceipt,
  Transfer,
} from "@/types/eth.js";
import type { MakeOptional, Prettify } from "@/types/utils.js";
import type { Trace as DebugTrace } from "@/utils/debug.js";
import type { PGliteOptions } from "@/utils/pglite.js";
import type { PGlite } from "@electric-sql/pglite";
import type { Hono } from "hono";
import type { PoolConfig } from "pg";
import type {
  Abi,
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

// Database

export type DatabaseConfig =
  | { kind: "pglite"; options: PGliteOptions }
  | { kind: "pglite_test"; instance: PGlite }
  | { kind: "postgres"; poolConfig: Prettify<PoolConfig & { max: number }> };

// Indexing

/** Indexing functions as defined in `ponder.on()` */
export type RawIndexingFunctions = {
  /** Name of the event */
  name: string;
  /** Callback function */
  fn: (...args: any) => any;
}[];

/** Indexing functions for event callbacks */
export type IndexingFunctions = {
  [eventName: string]: (...args: any) => any;
};

// Filters

/** Filter definition based on the fundamental data model of the Ethereum blockchain. */
export type Filter =
  | LogFilter
  | BlockFilter
  | TransferFilter
  | TransactionFilter
  | TraceFilter;
export type FilterWithoutBlocks =
  | Omit<BlockFilter, "fromBlock" | "toBlock">
  | Omit<TransactionFilter, "fromBlock" | "toBlock">
  | Omit<TraceFilter, "fromBlock" | "toBlock">
  | Omit<LogFilter, "fromBlock" | "toBlock">
  | Omit<TransferFilter, "fromBlock" | "toBlock">;

/** Filter that matches addresses. */
export type Factory = LogFactory;
export type FilterAddress<
  factory extends Factory | undefined = Factory | undefined,
> = factory extends Factory ? factory : Address | Address[] | undefined;

export type LogFilter<
  factory extends Factory | undefined = Factory | undefined,
> = {
  type: "log";
  chainId: number;
  address: FilterAddress<factory>;
  topic0: LogTopic;
  topic1: LogTopic;
  topic2: LogTopic;
  topic3: LogTopic;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  include:
    | (
        | `block.${keyof Block}`
        | `transaction.${keyof Transaction}`
        | `transactionReceipt.${keyof TransactionReceipt}`
        | `log.${keyof Log}`
      )[]
    | undefined;
};

export type BlockFilter = {
  type: "block";
  chainId: number;
  interval: number;
  offset: number;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  include: `block.${keyof Block}`[] | undefined;
};

export type TransferFilter<
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  type: "transfer";
  chainId: number;
  fromAddress: FilterAddress<fromFactory>;
  toAddress: FilterAddress<toFactory>;
  includeReverted: boolean;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  include:
    | (
        | `block.${keyof Block}`
        | `transaction.${keyof Transaction}`
        | `transactionReceipt.${keyof TransactionReceipt}`
        | `trace.${keyof Trace}`
      )[]
    | undefined;
};

export type TransactionFilter<
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  type: "transaction";
  chainId: number;
  fromAddress: FilterAddress<fromFactory>;
  toAddress: FilterAddress<toFactory>;
  includeReverted: boolean;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  include:
    | (
        | `block.${keyof Block}`
        | `transaction.${keyof Transaction}`
        | `transactionReceipt.${keyof TransactionReceipt}`
      )[]
    | undefined;
};

export type TraceFilter<
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  type: "trace";
  chainId: number;
  fromAddress: FilterAddress<fromFactory>;
  toAddress: FilterAddress<toFactory>;
  functionSelector: Hex | Hex[] | undefined;
  callType: Trace["type"] | undefined;
  includeReverted: boolean;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  include:
    | (
        | `block.${keyof Block}`
        | `transaction.${keyof Transaction}`
        | `transactionReceipt.${keyof TransactionReceipt}`
        | `trace.${keyof Trace}`
      )[]
    | undefined;
};

export type LogFactory = {
  type: "log";
  chainId: number;
  address: Address | Address[];
  eventSelector: Hex;
  childAddressLocation: "topic1" | "topic2" | "topic3" | `offset${number}`;
  fromBlock: number | undefined;
  toBlock: number | undefined;
};

// Fragments

export type FragmentAddress =
  | Address
  | {
      address: Address;
      eventSelector: Factory["eventSelector"];
      childAddressLocation: Factory["childAddressLocation"];
    }
  | null;

export type FragmentAddressId =
  | Address
  | `${Address}_${Factory["eventSelector"]}_${Factory["childAddressLocation"]}`
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
      functionSelector: Hex | null;
      includeTransactionReceipts: boolean;
    }
  | {
      type: "log";
      chainId: number;
      address: FragmentAddress;
      topic0: FragmentTopic;
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
  | `transfer_${number}_${FragmentAddressId}_${FragmentAddressId}_${0 | 1}`;

// Sources

/** Event source that matches {@link Event}s containing an underlying filter and metadata. */
export type Source = ContractSource | AccountSource | BlockSource;

export type ContractSource<
  filter extends "log" | "trace" = "log" | "trace",
  factory extends Factory | undefined = Factory | undefined,
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  filter: filter extends "log"
    ? LogFilter<factory>
    : TraceFilter<fromFactory, toFactory>;
} & ContractMetadata;

export type AccountSource<
  filter extends "transaction" | "transfer" = "transaction" | "transfer",
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  filter: filter extends "transaction"
    ? TransactionFilter<fromFactory, toFactory>
    : TransferFilter<fromFactory, toFactory>;
} & AccountMetadata;

export type BlockSource = { filter: BlockFilter } & BlockMetadata;

export type ContractMetadata = {
  type: "contract";
  abi: Abi;
  abiEvents: AbiEvents;
  abiFunctions: AbiFunctions;
  name: string;
  chain: Chain;
};
export type AccountMetadata = {
  type: "account";
  name: string;
  chain: Chain;
};
export type BlockMetadata = {
  type: "block";
  name: string;
  chain: Chain;
};

// Chain

export type Chain = {
  name: string;
  id: number;
  rpc: string | string[] | Transport;
  pollingInterval: number;
  maxRequestsPerSecond: number;
  finalityBlockCount: number;
  disableCache: boolean;
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
  ordering: "omnichain" | "multichain";
};

export type SchemaBuild = {
  schema: Schema;
  /** SQL statements to create the schema */
  statements: SqlStatements;
};

export type IndexingBuild = {
  /** Ten character hex string identifier. */
  buildId: string;
  /** Sources to index. */
  sources: Source[];
  /** Chains to index. */
  chains: Chain[];
  /** RPCs for all `chains`. */
  rpcs: Rpc[];
  /** Finalized blocks for all `chains`. */
  finalizedBlocks: LightBlock[];
  /** Event callbacks for all `sources`.  */
  indexingFunctions: IndexingFunctions;
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

// Seconds

export type Seconds = {
  [chain: string]: { start: number; end: number; cached: number };
};

// Blockchain data

export type SyncBlock = Prettify<
  MakeOptional<RpcBlock<Exclude<BlockTag, "pending">, true>, "size">
>;
export type SyncLog = ViemLog<Hex, Hex, false>;
export type SyncTransaction = RpcTransaction<false>;
export type SyncTransactionReceipt = RpcTransactionReceipt;
export type SyncTrace = {
  trace: DebugTrace["result"] & { index: number; subcalls: number };
  transactionHash: DebugTrace["txHash"];
};

export type LightBlock = Pick<
  SyncBlock,
  "hash" | "parentHash" | "number" | "timestamp"
>;

export type InternalBlock = Block;
export type InternalLog = Log & {
  blockNumber: number;
  transactionIndex: number;
};
export type InternalTransaction = Transaction & {
  blockNumber: number;
};
export type InternalTransactionReceipt = TransactionReceipt & {
  blockNumber: number;
  transactionIndex: number;
};
export type InternalTrace = Trace & {
  blockNumber: number;
  transactionIndex: number;
};

// Events

export type RawEvent = {
  chainId: number;
  sourceIndex: number;
  checkpoint: string;
  log?: InternalLog;
  block: InternalBlock;
  transaction?: InternalTransaction;
  transactionReceipt?: InternalTransactionReceipt;
  trace?: InternalTrace;
};

export type Event =
  | LogEvent
  | BlockEvent
  | TransactionEvent
  | TransferEvent
  | TraceEvent;

export type SetupEvent = {
  type: "setup";
  chainId: number;
  checkpoint: string;

  /** `${source.name}:setup` */
  name: string;

  block: bigint;
};

export type LogEvent = {
  type: "log";
  chainId: number;
  checkpoint: string;

  /** `${source.name}:${safeName}` */
  name: string;

  event: {
    id: string;
    args: { [key: string]: unknown } | readonly unknown[] | undefined;
    log: Log;
    block: Block;
    transaction: Transaction;
    transactionReceipt?: TransactionReceipt;
  };
};

export type BlockEvent = {
  type: "block";
  chainId: number;
  checkpoint: string;

  /** `${source.name}:block` */
  name: string;

  event: {
    id: string;
    block: Block;
  };
};

export type TransactionEvent = {
  type: "transaction";
  chainId: number;
  checkpoint: string;

  /** `${source.name}.{safeName}()` */
  name: string;

  event: {
    id: string;
    block: Block;
    transaction: Transaction;
    transactionReceipt?: TransactionReceipt;
  };
};

export type TransferEvent = {
  type: "transfer";
  chainId: number;
  checkpoint: string;

  /** `${source.name}:transfer:from` | `${source.name}:transfer:to` */
  name: string;

  event: {
    id: string;
    transfer: Transfer;
    block: Block;
    transaction: Transaction;
    transactionReceipt?: TransactionReceipt;
    trace: Trace;
  };
};

export type TraceEvent = {
  type: "trace";
  chainId: number;
  checkpoint: string;

  /** `${source.name}:transfer:from` | `${source.name}:transfer:to` */
  name: string;

  event: {
    id: string;
    args: { [key: string]: unknown } | readonly unknown[] | undefined;
    result: { [key: string]: unknown } | readonly unknown[] | undefined;
    trace: Trace;
    block: Block;
    transaction: Transaction;
    transactionReceipt?: TransactionReceipt;
  };
};
