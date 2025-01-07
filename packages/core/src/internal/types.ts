import type { SqlStatements } from "@/drizzle/kit/index.js";
import type { AbiEvents, AbiFunctions } from "@/sync/abi.js";
import type {
  Block,
  Log,
  Trace,
  Transaction,
  TransactionReceipt,
  Transfer,
} from "@/types/eth.js";
import type { Prettify } from "@/types/utils.js";
import type { PGliteOptions } from "@/utils/pglite.js";
import type { PGlite } from "@electric-sql/pglite";
import type { Hono } from "hono";
import type { PoolConfig } from "pg";
import type {
  Abi,
  Address,
  Hex,
  LogTopic,
  Transport,
  Chain as ViemChain,
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

/** Filter that matches addresses. */
export type Factory = LogFactory;

export type LogFilter<
  factory extends Factory | undefined = Factory | undefined,
> = {
  type: "log";
  chainId: number;
  address: factory extends Factory ? factory : Address | Address[] | undefined;
  topic0: LogTopic | undefined;
  topic1: LogTopic | undefined;
  topic2: LogTopic | undefined;
  topic3: LogTopic | undefined;
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
  fromAddress: fromFactory extends Factory
    ? fromFactory
    : Address | Address[] | undefined;
  toAddress: toFactory extends Factory
    ? fromFactory
    : Address | Address[] | undefined;
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
  fromAddress: fromFactory extends Factory
    ? fromFactory
    : Address | Address[] | undefined;
  toAddress: toFactory extends Factory
    ? toFactory
    : Address | Address[] | undefined;
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
  fromAddress: fromFactory extends Factory
    ? fromFactory
    : Address | Address[] | undefined;
  toAddress: toFactory extends Factory
    ? toFactory
    : Address | Address[] | undefined;
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
};

// Fragments

export type FragmentAddress =
  | Address
  | `${Address}_${Factory["eventSelector"]}_${Factory["childAddressLocation"]}`
  | null;

export type FragmentTopic = Hex | null;

/** Minimum slice of a {@link Filter} */
export type FragmentId =
  /** block_{chainId}_{interval}_{offset} */
  | `block_${number}_${number}_${number}`
  /** transaction_{chainId}_{fromAddress}_{toAddress} */
  | `transaction_${number}_${FragmentAddress}_${FragmentAddress}`
  /** trace_{chainId}_{fromAddress}_{toAddress}_{functionSelector}_{includeReceipts} */
  | `trace_${number}_${FragmentAddress}_${FragmentAddress}_${Hex | null}_${0 | 1}`
  /** log_{chainId}_{address}_{topic0}_{topic1}_{topic2}_{topic3}_{includeReceipts} */
  | `log_${number}_${FragmentAddress}_${FragmentTopic}_${FragmentTopic}_${FragmentTopic}_${FragmentTopic}_${0 | 1}`
  /** transfer_{chainId}_{fromAddress}_{toAddress}_{includeReceipts} */
  | `transfer_${number}_${FragmentAddress}_${FragmentAddress}_${0 | 1}`;

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
  chain: ViemChain;
  rpcUrl: string | string[] | Transport;
  pollingInterval: number;
  maxRequestsPerSecond: number;
  disableCache: boolean;
  finalityBlockCount: number;
};

// Schema

/** User-defined tables, enums, and indexes. */
export type Schema = { [name: string]: unknown };

// Build artifacts

/** Consolidated CLI, env vars, and config. */
export type PreBuild = {
  /** Database type and configuration */
  databaseConfig: DatabaseConfig;
  /** Database schema */
  namespace: string;
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

// Status

/** Closest-to-tip indexed block per chain. */
export type Status = {
  [chainId: number]: {
    block: { number: number; timestamp: number } | null;
    ready: boolean;
  };
};

// Events

export type RawEvent = {
  chainId: number;
  sourceIndex: number;
  checkpoint: string;
  log?: Log;
  block: Block;
  transaction?: Transaction;
  transactionReceipt?: TransactionReceipt;
  trace?: Trace;
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
    name: string;
    args: any;
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
    args: any;
    result: any;
    trace: Trace;
    block: Block;
    transaction: Transaction;
    transactionReceipt?: TransactionReceipt;
  };
};
