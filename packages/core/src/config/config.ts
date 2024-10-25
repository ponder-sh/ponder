import type { TransactionFilter, TransferFilter } from "@/sync/source.js";
import type { Prettify } from "@/types/utils.js";
import type { Abi } from "abitype";
import type { Narrow, Transport } from "viem";
import type { GetAddress } from "./address.js";
import type { GetEventFilter } from "./eventFilter.js";
import type { NonStrictPick } from "./utilityTypes.js";

export type BlockConfig = {
  /** Block number at which to start indexing events (inclusive). If `undefined`, events will be processed from block 0. Default: `undefined`. */
  startBlock?: number;
  /** Block number at which to stop indexing events (inclusive). If `undefined`, events will be processed in real-time. Default: `undefined`. */
  endBlock?: number;
};

type DatabaseConfig =
  | {
      kind: "sqlite";
      /** Directory path to use for SQLite database files. Default: `".ponder/sqlite"`. */
      directory?: string;
    }
  | {
      kind: "postgres";
      /** Postgres database connection string. Default: `DATABASE_PRIVATE_URL` > `DATABASE_URL` environment variable. */
      connectionString?: string;
      /** Postgres schema to use for indexed data. Default: 'public', or `RAILWAY_SERVICE_NAME`-`RAILWAY_DEPLOYMENT_ID` environment variables if provided. */
      schema?: string;
      /** Postgres schema to use for views returning indexed data. Default: undefined, or `RAILWAY_SERVICE_NAME` environment variable if provided. */
      publishSchema?: string;
      /** Postgres pool configuration passed to `node-postgres`. */
      poolConfig?: {
        /** Maximum number of clients in the pool. Default: `30`. */
        max?: number;
      };
    };

export type NetworkConfig<network> = {
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

export type BlockFilterConfig = {
  /** Block number at which to start indexing events (inclusive). If `undefined`, events will be processed from block 0. Default: `undefined`. */
  startBlock?: number;
  /** Block number at which to stop indexing events (inclusive). If `undefined`, events will be processed in real-time. Default: `undefined`. */
  endBlock?: number;
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

type AbiConfig<abi extends Abi | readonly unknown[]> = {
  /** Contract application byte interface. */
  abi: abi;
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

type GetNetwork<
  networks,
  contract,
  abi extends Abi,
  ///
  allNetworkNames extends string = [keyof networks] extends [never]
    ? string
    : keyof networks & string,
> = contract extends { network: infer network }
  ? {
      /**
       * Network that this contract is deployed to. Must match a network name in `networks`.
       * Any filter information overrides the values in the higher level "contracts" property.
       * Factories cannot override an address and vice versa.
       */
      network:
        | allNetworkNames
        | {
            [name in allNetworkNames]?: Prettify<
              GetAddress<NonStrictPick<network, "factory" | "address">> &
                GetEventFilter<abi, NonStrictPick<contract, "filter">> &
                TransactionReceiptConfig &
                FunctionCallConfig &
                BlockConfig
            >;
          };
    }
  : {
      /**
       * Network that this contract is deployed to. Must match a network name in `networks`.
       * Any filter information overrides the values in the higher level "contracts" property.
       * Factories cannot override an address and vice versa.
       */
      network:
        | allNetworkNames
        | {
            [name in allNetworkNames]?: Prettify<
              GetAddress<unknown> &
                GetEventFilter<abi, unknown> &
                TransactionReceiptConfig &
                FunctionCallConfig &
                BlockConfig
            >;
          };
    };

type GetAccountNetwork<
  networks,
  account,
  abi extends Abi,
  ///
  allNetworkNames extends string = [keyof networks] extends [never]
    ? string
    : keyof networks & string,
> = {
  /**
   * Network that this contract is deployed to. Must match a network name in `networks`.
   * Any filter information overrides the values in the higher level "accounts" property.
   * Factories cannot override an address and vice versa.
   */
  network:
    | allNetworkNames
    | {
        [name in allNetworkNames]?: Prettify<
          GetEventFilter<abi, NonStrictPick<account, "filter">> &
            GetTransactionConfig &
            GetTransferConfig &
            TransactionReceiptConfig &
            BlockConfig
        >;
      };
};

type ContractConfig<networks, contract, abi extends Abi> = Prettify<
  AbiConfig<abi> &
    GetNetwork<networks, NonStrictPick<contract, "network">, abi> &
    GetAddress<NonStrictPick<contract, "factory" | "address">> &
    GetEventFilter<abi, NonStrictPick<contract, "filter">> &
    TransactionReceiptConfig &
    FunctionCallConfig &
    BlockConfig
>;

type GetTransactionConfig = {
  transaction?: TransactionFilter | readonly TransactionFilter[];
};

type GetTransferConfig = {
  transfer?: TransferFilter | readonly TransferFilter[];
};

type AccountConfig<networks, account, abi extends Abi> = Prettify<
  AbiConfig<abi> &
    GetAccountNetwork<networks, NonStrictPick<account, "network">, abi> &
    GetEventFilter<abi, NonStrictPick<account, "filter">> &
    GetTransactionConfig &
    GetTransferConfig &
    TransactionReceiptConfig &
    BlockConfig
>;

type GetContract<networks = unknown, contract = unknown> = contract extends {
  abi: infer abi extends Abi;
}
  ? // 1. Contract has a valid abi
    ContractConfig<networks, contract, abi>
  : // 2. Contract has an invalid abi
    ContractConfig<networks, contract, Abi>;

type GetAccount<networks = unknown, account = unknown> = account extends {
  abi: infer abi extends Abi;
}
  ? // 1. Contract has a valid abi
    AccountConfig<networks, account, abi>
  : // 2. Contract has an invalid abi
    AccountConfig<networks, account, Abi>;

type ContractsConfig<networks, contracts> = {} extends contracts
  ? // contracts empty, return empty
    {}
  : {
      [name in keyof contracts]: GetContract<networks, contracts[name]>;
    };

type AccountsConfig<networks, accounts> = {} extends accounts
  ? // accounts empty, return empty
    {}
  : {
      [name in keyof accounts]: GetAccount<networks, accounts[name]>;
    };

type NetworksConfig<networks> = {} extends networks
  ? {}
  : {
      [networkName in keyof networks]: NetworkConfig<networks[networkName]>;
    };

type BlockFiltersConfig<
  networks = unknown,
  blocks = unknown,
> = {} extends blocks
  ? {}
  : {
      [name in keyof blocks]: GetBlockFilter<networks>;
    };

export const createConfig = <
  const networks,
  const contracts = {},
  const blocks = {},
  const accounts = {},
>(config: {
  // TODO: add jsdoc to these properties.
  networks: NetworksConfig<Narrow<networks>>;
  contracts: ContractsConfig<networks, Narrow<contracts>>;
  database?: DatabaseConfig;
  blocks?: BlockFiltersConfig<networks, blocks>;
  accounts: AccountsConfig<networks, Narrow<accounts>>;
}): CreateConfigReturnType<networks, contracts, accounts, blocks> =>
  config as Prettify<
    CreateConfigReturnType<networks, contracts, accounts, blocks>
  >;

export type Config = {
  networks: { [networkName: string]: NetworkConfig<unknown> };
  contracts: { [contractName: string]: GetContract };
  accounts: { [accountName: string]: GetAccount };
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
