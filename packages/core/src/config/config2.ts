import type { Prettify } from "@/types/utils.js";
import type { Abi, AbiEvent } from "abitype";
import { type Transport } from "viem";

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

type FactoryConfig<
  event extends AbiEvent = AbiEvent,
  parameter extends AbiEvent extends event
    ? string
    : event["inputs"][number]["name"] = AbiEvent extends event
    ? string
    : event["inputs"][number]["name"],
> = {
  /** Address of the factory contract that creates this contract. */
  address: `0x${string}`;
  /** ABI event that announces the creation of a new instance of this contract. */
  event: event;
  /** Name of the factory event parameter that contains the new child contract address. */
  parameter: parameter;
};

type AddressConfig<
  event extends AbiEvent = AbiEvent,
  parameter extends AbiEvent extends event
    ? string
    : event["inputs"][number]["name"] = AbiEvent extends event
    ? string
    : event["inputs"][number]["name"],
> =
  | {
      address: `0x${string}` | readonly `0x${string}`[];
      factory?: never;
    }
  | {
      address?: never;
      /** Factory contract configuration. */
      factory: FactoryConfig<event, parameter>;
    };

type ContractRequired<
  networkNames extends string,
  abi extends Abi | readonly unknown[],
  // TEventName extends string,
  // TFactoryEvent extends AbiEvent | undefined,
> = {
  /** Contract application byte interface. */
  abi: abi;
  /**
   * Network that this contract is deployed to. Must match a network name in `networks`.
   * Any filter information overrides the values in the higher level "contracts" property.
   * Factories cannot override an address and vice versa.
   */
  network: Partial<Record<networkNames, ContractOptional>> | networkNames;
};

type ContractOptional = BlockConfig;

export type ContractConfig<
  networkNames extends string = string,
  abi extends Abi | readonly unknown[] = Abi,
> = Prettify<ContractOptional & ContractRequired<networkNames, abi>>;

export const createConfig = <
  networkNames extends string,
  contractNames extends string,
  const abi extends Abi | readonly unknown[],
  const contract extends Record<
    contractNames,
    ContractConfig<networkNames, abi>
  > = Record<string, ContractConfig<networkNames, abi>>,
>(config: {
  networks: { [name in networkNames]: NetworkConfig };
  contracts: { [name in keyof contract]: contract[name] };
  database?: DatabaseConfig;
  options?: OptionConfig;
}) => config;

export type Config = Parameters<typeof createConfig>[0];
