import type { ConnectionOptions } from "node:tls";
import type { Prettify } from "@/types/utils.js";
import type { Abi } from "abitype";
import type { Narrow, Transport } from "viem";
import type { AddressConfig } from "./address.js";
import type { GetEventFilter } from "./eventFilter.js";

export type Config = {
  database?: DatabaseConfig;
  ordering?: "omnichain" | "multichain";
  chains: { [chainName: string]: ChainConfig<unknown> };
  contracts: { [contractName: string]: GetContract };
  accounts: { [accountName: string]: AccountConfig<unknown> };
  blocks: {
    [sourceName: string]: GetBlockFilter<unknown>;
  };
};

export type CreateConfigReturnType<chains, contracts, accounts, blocks> = {
  database?: DatabaseConfig;
  ordering?: "omnichain" | "multichain";
  chains: chains;
  contracts: contracts;
  accounts: accounts;
  blocks: blocks;
};

export const createConfig = <
  const chains,
  const contracts = {},
  const accounts = {},
  const blocks = {},
>(config: {
  database?: DatabaseConfig;
  ordering?: "omnichain" | "multichain";
  // TODO: add jsdoc to these properties.
  chains: ChainsConfig<Narrow<chains>>;
  contracts?: ContractsConfig<chains, Narrow<contracts>>;
  accounts?: AccountsConfig<chains, Narrow<accounts>>;
  blocks?: BlockFiltersConfig<chains, blocks>;
}): CreateConfigReturnType<chains, contracts, accounts, blocks> =>
  config as Prettify<
    CreateConfigReturnType<chains, contracts, accounts, blocks>
  >;

// database

type DatabaseConfig =
  | {
      kind: "pglite";
      /** Directory path to use for PGlite database files. Default: `".ponder/pglite"`. */
      directory?: string;
    }
  | {
      kind: "postgres";
      /** Postgres database connection string. Default: `DATABASE_PRIVATE_URL` > `DATABASE_URL` environment variable. */
      connectionString?: string;
      /** Postgres pool configuration passed to `node-postgres`. */
      poolConfig?: {
        /** Maximum number of clients in the pool. Default: `30`. */
        max?: number;
        /** Enable SSL, or provide a custom SSL configuration. Default: `undefined`. */
        ssl?: boolean | Prettify<ConnectionOptions>;
      };
    };

// base

type BlockConfig = {
  /** Block number at which to start indexing events (inclusive). If `undefined`, events will be processed from block 0. Default: `undefined`. */
  startBlock?: number | "latest";
  /** Block number at which to stop indexing events (inclusive). If `undefined`, events will be processed in real-time. Default: `undefined`. */
  endBlock?: number | "latest";
};

type TransactionReceiptConfig = {
  includeTransactionReceipts?: boolean;
};

type FunctionCallConfig = {
  /*
   * Enable call trace indexing for this contract.
   *
   * - Docs: https://ponder.sh/docs/guides/call-traces
   */
  includeCallTraces?: boolean;
};

// chain

type ChainConfig<chain> = {
  /** Chain ID of the chain. */
  id: chain extends { id: infer id extends number } ? id | number : number;
  /** RPC url. */
  rpc: string | string[] | Transport | undefined;
  /** Polling interval (in ms). Default: `1_000`. */
  pollingInterval?: number;
  /** Maximum number of RPC requests per second. Default: `50`. */
  maxRequestsPerSecond?: number;
  /** Disable RPC request caching. Default: `false`. */
  disableCache?: boolean;
};

type ChainsConfig<chains> = {} extends chains
  ? {}
  : {
      [chainName in keyof chains]: ChainConfig<chains[chainName]>;
    };

// contracts

type AbiConfig<abi extends Abi | readonly unknown[]> = {
  /** Contract application byte interface. */
  abi: abi;
};

type GetContractChain<
  chains,
  abi extends Abi,
  ///
  allChainNames extends string = [keyof chains] extends [never]
    ? string
    : keyof chains & string,
> = {
  /**
   * Chain that this contract is deployed to. Must match a chain name in `chains`.
   * Any filter information overrides the values in the higher level "contracts" property.
   */
  chain:
    | allChainNames
    | {
        [name in allChainNames]?: Prettify<
          AddressConfig &
            GetEventFilter<abi> &
            TransactionReceiptConfig &
            FunctionCallConfig &
            BlockConfig
        >;
      };
};

type ContractConfig<chains, abi extends Abi> = Prettify<
  AbiConfig<abi> &
    GetContractChain<chains, abi> &
    AddressConfig &
    GetEventFilter<abi> &
    TransactionReceiptConfig &
    FunctionCallConfig &
    BlockConfig
>;

type GetContract<chains = unknown, contract = unknown> = contract extends {
  abi: infer abi extends Abi;
}
  ? // 1. Contract has a valid abi
    ContractConfig<chains, abi>
  : // 2. Contract has an invalid abi
    ContractConfig<chains, Abi>;

type ContractsConfig<chains, contracts> = {} extends contracts
  ? // contracts empty, return empty
    {}
  : {
      [name in keyof contracts]: GetContract<chains, contracts[name]>;
    };

// accounts

type GetAccountChain<
  chains,
  ///
  allChainNames extends string = [keyof chains] extends [never]
    ? string
    : keyof chains & string,
> = {
  /**
   * Chain that this account is deployed to. Must match a chain name in `chains`.
   * Any filter information overrides the values in the higher level "accounts" property.
   */
  chain:
    | allChainNames
    | {
        [name in allChainNames]?: Prettify<
          AddressConfig & TransactionReceiptConfig & BlockConfig
        >;
      };
};

type AccountConfig<chains> = Prettify<
  GetAccountChain<chains> &
    Required<AddressConfig> &
    TransactionReceiptConfig &
    BlockConfig
>;

type AccountsConfig<chains, accounts> = {} extends accounts
  ? {}
  : {
      [name in keyof accounts]: AccountConfig<chains>;
    };

// blocks

type BlockFilterConfig = {
  /** Block number at which to start indexing events (inclusive). If `undefined`, events will be processed from block 0. Default: `undefined`. */
  startBlock?: number | "latest";
  /** Block number at which to stop indexing events (inclusive). If `undefined`, events will be processed in real-time. Default: `undefined`. */
  endBlock?: number | "latest";
  interval?: number;
};

type GetBlockFilter<
  chains,
  ///
  allChainNames extends string = [keyof chains] extends [never]
    ? string
    : keyof chains & string,
> = BlockFilterConfig & {
  chain:
    | allChainNames
    | {
        [name in allChainNames]?: BlockFilterConfig;
      };
};

type BlockFiltersConfig<chains = unknown, blocks = unknown> = {} extends blocks
  ? {}
  : {
      [name in keyof blocks]: GetBlockFilter<chains>;
    };
