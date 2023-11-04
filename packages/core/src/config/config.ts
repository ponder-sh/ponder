import type { Abi, AbiEvent, FormatAbiItem } from "abitype";
import type { GetEventArgs, Transport } from "viem";

/**
 * Keep only AbiEvents from an Abi
 */
export type FilterEvents<T extends Abi> = T extends readonly [
  infer First,
  ...infer Rest extends Abi
]
  ? First extends AbiEvent
    ? readonly [First, ...FilterEvents<Rest>]
    : FilterEvents<Rest>
  : [];

/**
 * Remove TElement from TArr
 */
type FilterElement<
  TElement,
  TArr extends readonly unknown[]
> = TArr extends readonly [infer First, ...infer Rest]
  ? TElement extends First
    ? FilterElement<TElement, Rest>
    : readonly [First, ...FilterElement<TElement, Rest>]
  : [];

/**
 * Return an array of safe event names that handle multiple events with the same name
 */
export type SafeEventNames<
  TAbi extends readonly AbiEvent[],
  TArr extends readonly AbiEvent[]
> = TAbi extends readonly [
  infer First extends AbiEvent,
  ...infer Rest extends readonly AbiEvent[]
]
  ? First["name"] extends FilterElement<First, TArr>[number]["name"]
    ? // Name collisions exist, format long name
      FormatAbiItem<First> extends `event ${infer LongEvent extends string}`
      ? readonly [LongEvent, ...SafeEventNames<Rest, TArr>]
      : never
    : // Short name
      readonly [First["name"], ...SafeEventNames<Rest, TArr>]
  : [];

export type RecoverAbiEvent<
  TAbi extends readonly AbiEvent[],
  TSafeNames extends readonly string[],
  TSafeName extends string
> = TAbi extends readonly [
  infer FirstAbi,
  ...infer RestAbi extends readonly AbiEvent[]
]
  ? TSafeNames extends readonly [
      infer FirstName,
      ...infer RestName extends readonly string[]
    ]
    ? FirstName extends TSafeName
      ? FirstAbi
      : RecoverAbiEvent<RestAbi, RestName, TSafeName>
    : []
  : [];

type ContractRequired<
  TNetworkNames extends string,
  TAbi extends readonly AbiEvent[],
  TEventName extends string
> = {
  /** Contract name. Must be unique across `contracts` and `filters`. */
  name: string;
  /**
   * Network that this contract is deployed to. Must match a network name in `networks`.
   * Any filter information overrides the values in the higher level "contracts" property. Factories cannot override an address and vice versa.
   */
  network: readonly ({ name: TNetworkNames } & Partial<
    ContractFilter<TAbi, TEventName>
  >)[];
  abi: Abi;
};

type ContractFilter<
  TAbi extends readonly AbiEvent[],
  TEventName extends string
> = (
  | {
      /** Contract address. */
      address?: `0x${string}`;
    }
  | {
      /** Factory contract configuration. */
      factory: {
        /** Address of the factory contract that creates this contract. */
        address: `0x${string}`;
        /** ABI event that announces the creation of a new instance of this contract. */
        event: AbiEvent;
        /** Name of the factory event parameter that contains the new child contract address. */
        parameter: string; // TODO: Narrow type to known parameter names from `event`.
      };
    }
) & {
  /** Block number at which to start indexing events (inclusive). Default: `0`. */
  startBlock?: number;
  /** Block number at which to stop indexing events (inclusive). If `undefined`, events will be processed in real-time. Default: `undefined`. */
  endBlock?: number;
  /** Maximum block range to use when calling `eth_getLogs`. Default: `10_000`. */
  maxBlockRange?: number;

  filter?: readonly AbiEvent[] extends TAbi
    ? string[] | { event: string; args?: unknown }
    :
        | readonly SafeEventNames<
            FilterEvents<TAbi>,
            FilterEvents<TAbi>
          >[number][]
        | {
            event: SafeEventNames<
              FilterEvents<TAbi>,
              FilterEvents<TAbi>
            >[number];
            args?: GetEventArgs<
              Abi,
              string,
              {
                EnableUnion: true;
                IndexedOnly: true;
                Required: false;
              },
              RecoverAbiEvent<
                TAbi,
                SafeEventNames<FilterEvents<TAbi>, FilterEvents<TAbi>>,
                TEventName
              > extends infer _abiEvent extends AbiEvent
                ? _abiEvent
                : AbiEvent
            >;
          };
};

type Database =
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

type Network = {
  /** Network name. Must be unique across all networks. */
  name: string;
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
  /** Maximum concurrency of RPC requests during the historical sync. Default: `10`. */
  maxRpcRequestConcurrency?: number;
};

type Contract<
  TNetworkNames extends string,
  TAbi extends readonly AbiEvent[],
  TEventName extends string
> = ContractRequired<TNetworkNames, TAbi, TEventName> &
  ContractFilter<TAbi, TEventName>;

type Option = {
  /** Maximum number of seconds to wait for event processing to be complete before responding as healthy. If event processing exceeds this duration, the API may serve incomplete data. Default: `240` (4 minutes). */
  maxHealthcheckDuration?: number;
};

export type ResolvedConfig = {
  /** Database to use for storing blockchain & entity data. Default: `"postgres"` if `DATABASE_URL` env var is present, otherwise `"sqlite"`. */
  database?: Database;
  /** List of blockchain networks. */
  networks: readonly Network[];
  /** List of contracts to sync & index events from. Contracts defined here will be present in `context.contracts`. */
  contracts?: readonly Contract<string, readonly AbiEvent[], string>[];
  /** Configuration for Ponder internals. */
  options?: Option;
};

/**
 * Identity function for type-level validation of config
 */
export const createConfig = <
  const TConfig extends {
    database?: Database;
    networks: readonly Network[];
    contracts: {
      [key in keyof TConfig["contracts"] & number]: Contract<
        TConfig["networks"][number]["name"],
        FilterEvents<TConfig["contracts"][key]["abi"]>,
        TConfig["contracts"][key]["filter"] extends {
          event: infer _event extends string;
        }
          ? _event
          : string
      >;
    };
    options?: Option;
  }
>(
  config:
    | TConfig
    | Promise<TConfig>
    | (() => TConfig)
    | (() => Promise<TConfig>)
) => config;
