import type { Prettify } from "@/types/utils.js";
import type { Abi } from "abitype";
import type { Narrow, Transport } from "viem";
import type { AddressConfig } from "./address.js";
import type { GetEventFilter } from "./eventFilter.js";
import type { NonStrictPick } from "./utilityTypes.js";

export type Config = {
  networks: { [networkName: string]: NetworkConfig<unknown> };
  contracts: { [contractName: string]: GetContract };
  accounts: { [accountName: string]: AccountConfig<unknown> };
  database?: DatabaseConfig;
  blocks: {
    [sourceName: string]: GetBlockFilter<unknown>;
  };
};

export type CreateConfigReturnType<networks, contracts, accounts, blocks> = {
  networks: networks;
  contracts: contracts;
  accounts: accounts;
  database?: DatabaseConfig;
  blocks: blocks;
};

export const createConfig = <
  const networks,
  const contracts = {},
  const accounts = {},
  const blocks = {},
>(config: {
  database?: DatabaseConfig;
  // TODO: add jsdoc to these properties.
  networks: NetworksConfig<Narrow<networks>>;
  contracts?: ContractsConfig<networks, Narrow<contracts>>;
  accounts?: AccountsConfig<networks, Narrow<accounts>>;
  blocks?: BlockFiltersConfig<networks, blocks>;
}): CreateConfigReturnType<networks, contracts, accounts, blocks> =>
  config as Prettify<
    CreateConfigReturnType<networks, contracts, accounts, blocks>
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
      };
    };

// base

type BlockConfig = {
  /** Block intervals with startBlock (inclusive) and endBlock (inclusive). If `undefined`, events will be processed from block 0 and in real-time. */
  blocks?: [number | undefined, number | undefined][];
};

type TransactionReceiptConfig = {
  includeTransactionReceipts?: boolean;
};

type FunctionCallConfig = {
  /*
   * Enable call trace indexing for this contract.
   *
   * - Docs: https://ponder.sh/docs/indexing/call-traces
   */
  includeCallTraces?: boolean;
};

// network

type NetworkConfig<network> = {
  /** Chain ID of the network. */
  chainId: network extends { chainId: infer chainId extends number }
    ? chainId | number
    : number;
  /** A viem `http`, `webSocket`, or `fallback` [Transport](https://viem.sh/docs/clients/transports/http.html).
   *
   * __To avoid rate limiting, include a custom RPC URL.__ Usage:
   *
   * ```ts
   * import { http } from "viem";
   *
   * const network = {
   *    name: "mainnet",
   *    chainId: 1,
   *    transport: http("https://eth-mainnet.g.alchemy.com/v2/..."),
   * }
   * ```
   */
  transport: Transport;
  /** Polling interval (in ms). Default: `1_000`. */
  pollingInterval?: number;
  /** Maximum number of RPC requests per second. Default: `50`. */
  maxRequestsPerSecond?: number;
  /** Disable RPC request caching. Default: `false`. */
  disableCache?: boolean;
};

type NetworksConfig<networks> = {} extends networks
  ? {}
  : {
      [networkName in keyof networks]: NetworkConfig<networks[networkName]>;
    };

// contracts

type AbiConfig<abi extends Abi | readonly unknown[]> = {
  /** Contract application byte interface. */
  abi: abi;
};

type GetContractNetwork<
  networks,
  contract,
  abi extends Abi,
  ///
  allNetworkNames extends string = [keyof networks] extends [never]
    ? string
    : keyof networks & string,
> = {
  /**
   * Network that this contract is deployed to. Must match a network name in `networks`.
   * Any filter information overrides the values in the higher level "contracts" property.
   */
  network:
    | allNetworkNames
    | {
        [name in allNetworkNames]?: Prettify<
          AddressConfig &
            GetEventFilter<abi, NonStrictPick<contract, "filter">> &
            TransactionReceiptConfig &
            FunctionCallConfig &
            BlockConfig
        >;
      };
};

type ContractConfig<networks, contract, abi extends Abi> = Prettify<
  AbiConfig<abi> &
    GetContractNetwork<networks, NonStrictPick<contract, "network">, abi> &
    AddressConfig &
    GetEventFilter<abi, NonStrictPick<contract, "filter">> &
    TransactionReceiptConfig &
    FunctionCallConfig &
    BlockConfig
>;

type GetContract<networks = unknown, contract = unknown> = contract extends {
  abi: infer abi extends Abi;
}
  ? // 1. Contract has a valid abi
    ContractConfig<networks, contract, abi>
  : // 2. Contract has an invalid abi
    ContractConfig<networks, contract, Abi>;

type ContractsConfig<networks, contracts> = {} extends contracts
  ? // contracts empty, return empty
    {}
  : {
      [name in keyof contracts]: GetContract<networks, contracts[name]>;
    };

// accounts

type GetAccountNetwork<
  networks,
  ///
  allNetworkNames extends string = [keyof networks] extends [never]
    ? string
    : keyof networks & string,
> = {
  /**
   * Network that this account is deployed to. Must match a network name in `networks`.
   * Any filter information overrides the values in the higher level "accounts" property.
   */
  network:
    | allNetworkNames
    | {
        [name in allNetworkNames]?: Prettify<
          AddressConfig & TransactionReceiptConfig & BlockConfig
        >;
      };
};

type AccountConfig<networks> = Prettify<
  GetAccountNetwork<networks> &
    Required<AddressConfig> &
    TransactionReceiptConfig &
    BlockConfig
>;

type AccountsConfig<networks, accounts> = {} extends accounts
  ? {}
  : {
      [name in keyof accounts]: AccountConfig<networks>;
    };

// blocks

type BlockFilterConfig = BlockConfig & {
  interval?: number;
};

type GetBlockFilter<
  networks,
  ///
  allNetworkNames extends string = [keyof networks] extends [never]
    ? string
    : keyof networks & string,
> = BlockFilterConfig & {
  network:
    | allNetworkNames
    | {
        [name in allNetworkNames]?: BlockFilterConfig;
      };
};

type BlockFiltersConfig<
  networks = unknown,
  blocks = unknown,
> = {} extends blocks
  ? {}
  : {
      [name in keyof blocks]: GetBlockFilter<networks>;
    };
