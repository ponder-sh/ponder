import type { Prettify } from "@/types/utils.js";
import type { Abi } from "abitype";
import type { Narrow, Transport } from "viem";
import type { Chain } from "viem";
import type { AddressConfig } from "./address.js";
import type { GetEventFilter } from "./eventFilter.js";

export type Config = {
  chains: readonly Chain[];
  rpcUrls: { [chainId: Chain["id"]]: string | string[] | Transport };
  pollingInterval?: { [chainId: Chain["id"]]: number };
  maxRequestsPerSecond?: { [chainId: Chain["id"]]: number };
  disableCache?: { [chainId: Chain["id"]]: boolean };
  contracts: { [contractName: string]: GetContract<readonly Chain[]> };
  accounts: { [accountName: string]: AccountConfig<readonly Chain[]> };
  database?: DatabaseConfig;
  blocks: {
    [sourceName: string]: GetBlockFilter<readonly Chain[]>;
  };
};

export type CreateConfigReturnType<chains, contracts, accounts, blocks> = {
  chains: chains;
  rpcUrls: Config["rpcUrls"];
  pollingInterval: Config["pollingInterval"];
  maxRequestsPerSecond: Config["maxRequestsPerSecond"];
  disableCache: Config["disableCache"];
  contracts: contracts;
  accounts: accounts;
  database?: DatabaseConfig;
  blocks: blocks;
};

export const createConfig = <
  const chains extends readonly Chain[],
  const contracts = {},
  const accounts = {},
  const blocks = {},
>(config: {
  database?: DatabaseConfig;
  // TODO: add jsdoc to these properties.
  chains: chains;
  rpcUrls: {
    [chainId in chains[number]["id"]]: Config["rpcUrls"][keyof Config["rpcUrls"]];
  };
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
      };
    };

// base

type BlockConfig = {
  /** Block number at which to start indexing events (inclusive). If `undefined`, events will be processed from block 0. Default: `undefined`. */
  startBlock?: number;
  /** Block number at which to stop indexing events (inclusive). If `undefined`, events will be processed in real-time. Default: `undefined`. */
  endBlock?: number;
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

// contracts

type AbiConfig<abi extends Abi | readonly unknown[]> = {
  /** Contract application byte interface. */
  abi: abi;
};

type GetContractChain<
  chains extends readonly Chain[],
  abi extends Abi,
  ///
  allChainIds extends number = chains[number]["id"],
> = {
  /**
   * Chain that this contract is deployed to. Must match a chain id in `chains`.
   * Any filter information overrides the values in the higher level "contracts" property.
   */
  chain:
    | allChainIds
    | {
        [id in allChainIds]?: Prettify<
          AddressConfig &
            GetEventFilter<abi> &
            TransactionReceiptConfig &
            FunctionCallConfig &
            BlockConfig
        >;
      };
};

type ContractConfig<
  chains extends readonly Chain[],
  abi extends Abi,
> = Prettify<
  AbiConfig<abi> &
    GetContractChain<chains, abi> &
    AddressConfig &
    GetEventFilter<abi> &
    TransactionReceiptConfig &
    FunctionCallConfig &
    BlockConfig
>;

type GetContract<
  chains extends readonly Chain[],
  contract = unknown,
> = contract extends {
  abi: infer abi extends Abi;
}
  ? // 1. Contract has a valid abi
    ContractConfig<chains, abi>
  : // 2. Contract has an invalid abi
    ContractConfig<chains, Abi>;

type ContractsConfig<
  chains extends readonly Chain[],
  contracts,
> = {} extends contracts
  ? // contracts empty, return empty
    {}
  : {
      [name in keyof contracts]: GetContract<chains, contracts[name]>;
    };

// accounts

type GetAccountChain<
  chains extends readonly Chain[],
  ///
  allChainIds extends number = chains[number]["id"],
> = {
  /**
   * Chain that this account is deployed to. Must match a chain id in `chains`.
   * Any filter information overrides the values in the higher level "accounts" property.
   */
  chain:
    | allChainIds
    | {
        [id in allChainIds]?: Prettify<
          AddressConfig & TransactionReceiptConfig & BlockConfig
        >;
      };
};

type AccountConfig<chains extends readonly Chain[]> = Prettify<
  GetAccountChain<chains> &
    Required<AddressConfig> &
    TransactionReceiptConfig &
    BlockConfig
>;

type AccountsConfig<
  chains extends readonly Chain[],
  accounts,
> = {} extends accounts
  ? {}
  : {
      [name in keyof accounts]: AccountConfig<chains>;
    };

// blocks

type BlockFilterConfig = {
  /** Block number at which to start indexing events (inclusive). If `undefined`, events will be processed from block 0. Default: `undefined`. */
  startBlock?: number;
  /** Block number at which to stop indexing events (inclusive). If `undefined`, events will be processed in real-time. Default: `undefined`. */
  endBlock?: number;
  interval?: number;
};

type GetBlockFilter<
  chains extends readonly Chain[],
  ///
  allChainIds extends number = chains[number]["id"],
> = BlockFilterConfig & {
  chain:
    | allChainIds
    | {
        [id in allChainIds]?: BlockFilterConfig;
      };
};

type BlockFiltersConfig<
  chains extends readonly Chain[],
  blocks = unknown,
> = {} extends blocks
  ? {}
  : {
      [name in keyof blocks]: GetBlockFilter<chains>;
    };
