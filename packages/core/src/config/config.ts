import type { Prettify } from "@/types/utils.js";
import type { Abi } from "abitype";
import { type Narrow, type Transport } from "viem";
import type { GetAddress } from "./address.js";
import type { GetEventFilter } from "./eventFilter.js";
import type { NonStrictPick } from "./utilityTypes.js";

export type BlockConfig = {
  /** Block number at which to start indexing events (inclusive). If `undefined`, events will be processed from block 0. Default: `undefined`. */
  startBlock?: number;
  /** Block number at which to stop indexing events (inclusive). If `undefined`, events will be processed in real-time. Default: `undefined`. */
  endBlock?: number;
  /** Maximum block range to use when calling `eth_getLogs`. Default: `10_000`. */
  maxBlockRange?: number;
};

type DatabaseConfig =
  | {
      kind: "sqlite";
      /** Path to SQLite database file. Default: `".ponder/store"`. */
      filename?: string;
    }
  | {
      kind: "postgres";
      /** PostgreSQL database connection string. Default: `process.env.DATABASE_PRIVATE_URL` or `process.env.DATABASE_URL`. */
      connectionString?: string;
    };

export type OptionConfig = {
  /** Maximum number of seconds to wait for event processing to be complete before responding as healthy. If event processing exceeds this duration, the API may serve incomplete data. Default: `240` (4 minutes). */
  maxHealthcheckDuration?: number;
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
  /** Polling frequency (in ms). Default: `1_000`. */
  pollingInterval?: number;
  /** Maximum number of RPC requests per second. Default: `50`. */
  maxRequestsPerSecond?: number;
  /** (Deprecated) Maximum concurrency of tasks during the historical sync. Default: `20`. */
  maxHistoricalTaskConcurrency?: number;
};

type AbiConfig<abi extends Abi | readonly unknown[]> = {
  /** Contract application byte interface. */
  abi: abi;
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
              GetAddress<unknown> & GetEventFilter<abi, unknown> & BlockConfig
            >;
          };
    };

type ContractConfig<networks, contract, abi extends Abi> = Prettify<
  AbiConfig<abi> &
    GetNetwork<networks, NonStrictPick<contract, "network">, abi> &
    GetAddress<NonStrictPick<contract, "factory" | "address">> &
    GetEventFilter<abi, NonStrictPick<contract, "filter">> &
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

type NetworksConfig<networks> = {} extends networks
  ? {}
  : {
      [networkName in keyof networks]: NetworkConfig<networks[networkName]>;
    };

export const createConfig = <const networks, const contracts>(config: {
  // TODO: add jsdoc to these properties.
  networks: NetworksConfig<Narrow<networks>>;
  contracts: ContractsConfig<networks, Narrow<contracts>>;
  database?: DatabaseConfig;
  options?: OptionConfig;
}): CreateConfigReturnType<networks, contracts> =>
  config as CreateConfigReturnType<networks, contracts>;

export type Config = {
  networks: { [name: string]: NetworkConfig<unknown> };
  contracts: { [name: string]: GetContract };
  database?: DatabaseConfig;
  options?: OptionConfig;
};

export type CreateConfigReturnType<networks, contracts> = {
  networks: networks;
  contracts: contracts;
  database?: DatabaseConfig;
  options?: OptionConfig;
};
