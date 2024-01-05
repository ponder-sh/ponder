import type { Prettify } from "@/types/utils.js";
import type { Abi } from "abitype";
import { type Transport } from "viem";
import type { GetAddress } from "./address.js";

export type BlockConfig = {
  /** Block number at which to start indexing events (inclusive). If `undefined`, events will be processed from block 0. Default: `undefined`. */
  startBlock?: number;
  /** Block number at which to stop indexing events (inclusive). If `undefined`, events will be processed in real-time. Default: `undefined`. */
  endBlock?: number;
  /** Maximum block range to use when calling `eth_getLogs`. Default: `10_000`. */
  maxBlockRange?: number;
};

export type DatabaseConfig =
  | {
      kind: "sqlite";
      /** Path to SQLite database file. Default: `"./.ponder/cache.db"`. */
      filename?: string;
    }
  | {
      kind: "postgres";
      /** PostgreSQL database connection string. Default: `process.env.DATABASE_URL`. */
      connectionString?: string;
    };

export type OptionConfig = {
  /** Maximum number of seconds to wait for event processing to be complete before responding as healthy. If event processing exceeds this duration, the API may serve incomplete data. Default: `240` (4 minutes). */
  maxHealthcheckDuration?: number;
};

export type NetworkConfig = {
  /** Chain ID of the network. */
  chainId: number;
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
  /** Maximum concurrency of tasks during the historical sync. Default: `20`. */
  maxHistoricalTaskConcurrency?: number;
};

type ContractRequired<
  networks extends { [name: string]: unknown },
  abi extends Abi | readonly unknown[],
  contractNetwork extends keyof networks = keyof networks,
  ///
  allNetworkNames = keyof networks,
> = {
  /** Contract application byte interface. */
  abi: abi;
  /**
   * Network that this contract is deployed to. Must match a network name in `networks`.
   * Any filter information overrides the values in the higher level "contracts" property.
   * Factories cannot override an address and vice versa.
   */
  network:
    | allNetworkNames
    | (contractNetwork extends allNetworkNames ? contractNetwork : never);
};

type GetContract<
  networks extends { [name: string]: unknown },
  contract,
> = contract extends {
  abi: infer abi extends Abi;
}
  ? // 1. Contract has a valid abi
    contract extends { network: infer contractNetwork extends keyof networks }
    ? // 1.a Contract has a valid abi and network
      Prettify<
        ContractRequired<networks, abi, contractNetwork> &
          GetAddress<Omit<contract, "network" | "abi">>
      >
    : // 1.b Contract has valid abi and invalid network
      Prettify<ContractRequired<networks, abi>>
  : // 2. Contract has an invalid abi
    contract extends { network: infer contractNetwork extends keyof networks }
    ? // 2.a Contract has an invalid abi and a valid network
      Prettify<ContractRequired<networks, Abi, contractNetwork>>
    : // 2.b Contract has an invalid abi and an invalid network
      Prettify<ContractRequired<networks, Abi>>;

type ContractsConfig<
  networks extends { [name: string]: unknown },
  contracts,
> = {} extends contracts // contracts empty, return empty
  ? {}
  : contracts extends { c2: infer contract }
    ? { c2: GetContract<networks, contract> & BlockConfig }
    : never;

type NetworksConfig<networks extends { [name: string]: unknown }> = {
  [networkName in keyof networks]: NetworkConfig;
};

export const createConfig = <
  const networks extends { [name: string]: unknown },
  const contracts extends { [name: string]: unknown },
>(config: {
  // TODO: add jsdoc to these properties.
  networks: NetworksConfig<networks>;
  contracts: ContractsConfig<networks, contracts>;
  database?: DatabaseConfig;
  options?: OptionConfig;
}) => {
  return config;
};

export type Config = Parameters<typeof createConfig>[0];
