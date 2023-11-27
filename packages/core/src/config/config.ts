import type { Abi, AbiEvent, FormatAbiItem } from "abitype";
import type { GetEventArgs, Transport } from "viem";

export type FilterAbiEvents<T extends Abi> = T extends readonly [
  infer First,
  ...infer Rest extends Abi,
]
  ? First extends AbiEvent
    ? readonly [First, ...FilterAbiEvents<Rest>]
    : FilterAbiEvents<Rest>
  : [];

/**
 * Remove TElement from TArr.
 */
type FilterElement<
  TElement,
  TArr extends readonly unknown[],
> = TArr extends readonly [infer First, ...infer Rest]
  ? TElement extends First
    ? FilterElement<TElement, Rest>
    : readonly [First, ...FilterElement<TElement, Rest>]
  : [];

/**
 * Return an array of safe event names that handle event overridding.
 */
export type SafeEventNames<
  TAbi extends readonly AbiEvent[],
  TArr extends readonly AbiEvent[] = TAbi,
> = TAbi extends readonly [
  infer First extends AbiEvent,
  ...infer Rest extends readonly AbiEvent[],
]
  ? First["name"] extends FilterElement<First, TArr>[number]["name"]
    ? // Overriding occurs, use full name
      FormatAbiItem<First> extends `event ${infer LongEvent extends string}`
      ? readonly [LongEvent, ...SafeEventNames<Rest, TArr>]
      : never
    : // Short name
      readonly [First["name"], ...SafeEventNames<Rest, TArr>]
  : [];

/**
 * Recover the element from {@link TAbi} at the index where {@link TSafeName} is equal to {@link TSafeNames}[index].
 */
export type RecoverAbiEvent<
  TAbi extends readonly AbiEvent[],
  TSafeName extends string,
  TSafeNames extends readonly string[] = SafeEventNames<TAbi>,
> = TAbi extends readonly [
  infer FirstAbi,
  ...infer RestAbi extends readonly AbiEvent[],
]
  ? TSafeNames extends readonly [
      infer FirstName,
      ...infer RestName extends readonly string[],
    ]
    ? FirstName extends TSafeName
      ? FirstAbi
      : RecoverAbiEvent<RestAbi, TSafeName, RestName>
    : never
  : never;

/** Required fields for a contract. */
export type ContractRequired<
  TNetworkNames extends string,
  TAbi extends Abi | unknown,
  TEventName extends string,
  TFactoryEvent extends AbiEvent | undefined,
> = {
  /** Contract application byte interface. */
  abi: Abi;
  /**
   * Network that this contract is deployed to. Must match a network name in `networks`.
   * Any filter information overrides the values in the higher level "contracts" property.
   * Factories cannot override an address and vice versa.
   */
  network:
    | Partial<
        Record<
          TNetworkNames,
          Partial<ContractFilter<TAbi, TEventName, TFactoryEvent>>
        >
      >
    | TNetworkNames;
};

/** Fields for a contract used to filter down which events indexed. */
export type ContractFilter<
  TAbi extends Abi | unknown,
  TEventName extends string,
  TFactoryEvent extends AbiEvent | undefined,
> = (
  | {
      address?: `0x${string}` | readonly `0x${string}`[];
      factory?: never;
    }
  | {
      address?: never;
      /** Factory contract configuration. */
      factory?: {
        /** Address of the factory contract that creates this contract. */
        address: `0x${string}`;
        /** ABI event that announces the creation of a new instance of this contract. */
        event: AbiEvent;
        /** Name of the factory event parameter that contains the new child contract address. */
        parameter: TFactoryEvent extends AbiEvent
          ? TFactoryEvent["inputs"][number]["name"]
          : string;
      };
    }
) & {
  /** Block number at which to start indexing events (inclusive). Default: `0`. */
  startBlock?: number;
  /** Block number at which to stop indexing events (inclusive). If `undefined`, events will be processed in real-time. Default: `undefined`. */
  endBlock?: number;
  /** Maximum block range to use when calling `eth_getLogs`. Default: `10_000`. */
  maxBlockRange?: number;

  filter?: Abi extends TAbi
    ?
        | { event: readonly string[]; args?: never }
        | { event: string; args?: GetEventArgs<Abi, string> }
    : TAbi extends Abi
      ?
          | {
              event: readonly SafeEventNames<FilterAbiEvents<TAbi>>[number][];
              args?: never;
            }
          | {
              event: SafeEventNames<FilterAbiEvents<TAbi>>[number];
              args?: GetEventArgs<
                Abi,
                string,
                {
                  EnableUnion: true;
                  IndexedOnly: true;
                  Required: false;
                },
                RecoverAbiEvent<
                  FilterAbiEvents<TAbi>,
                  TEventName,
                  SafeEventNames<FilterAbiEvents<TAbi>>
                > extends infer _abiEvent extends AbiEvent
                  ? _abiEvent
                  : AbiEvent
              >;
            }
      : never;
};

/** Contract in Ponder config. */
export type Contract<
  TNetworkNames extends string,
  TAbi extends Abi | unknown,
  TEventName extends string,
  TFactoryEvent extends AbiEvent | undefined,
> = ContractRequired<TNetworkNames, TAbi, TEventName, TFactoryEvent> &
  ContractFilter<TAbi, TEventName, TFactoryEvent>;

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

/** Network in Ponder config. */
export type Network = {
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

type Option = {
  /** Maximum number of seconds to wait for event processing to be complete before responding as healthy. If event processing exceeds this duration, the API may serve incomplete data. Default: `240` (4 minutes). */
  maxHealthcheckDuration?: number;
};

export type Config = {
  /** Database to use for storing raw & indexed data. Default: `"postgres"` if `DATABASE_URL` env var is present, otherwise `"sqlite"`. */
  database?: Database;
  networks: Record<string, Network>;
  /** List of contracts to sync & index events from. Contracts defined here will be present in `context.contracts`. */
  contracts: Record<string, Contract<string, Abi, string, undefined>>;
  /** Configuration for Ponder internals. */
  options?: Option;
};

/**
 * Validates type of config, and returns a strictly typed, resolved config.
 */
export const createConfig = <
  const TConfig extends {
    database?: Database;
    networks: Record<string, Network>;
    contracts: {
      [ContractName in keyof TConfig["contracts"]]: Contract<
        keyof TConfig["networks"] & string,
        TConfig["contracts"][ContractName]["abi"],
        TConfig["contracts"][ContractName] extends {
          event: infer _event extends string;
        }
          ? _event
          : string,
        TConfig["contracts"][ContractName] extends {
          factory: {
            event: infer _event extends AbiEvent;
          };
        }
          ? _event
          : undefined
      >;
    };
    options?: Option;
  },
>(
  config: TConfig,
): TConfig => {
  // convert to an easier type to use
  const contracts = config.contracts as Record<
    string,
    Contract<string, AbiEvent[], string, AbiEvent>
  >;

  Object.values(contracts).forEach((contract) => {
    if (typeof contract.network === "string") {
      // shortcut
      const network = config.networks[contract.network];
      if (!network)
        throw Error('Contract network does not match a network in "networks"');

      // Validate the address / factory data
      const resolvedFactory = "factory" in contract && contract.factory;
      const resolvedAddress = "address" in contract && contract.address;
      if (resolvedFactory && resolvedAddress)
        throw Error("Factory and address cannot both be defined");
    } else {
      Object.entries(contract.network).forEach(
        ([networkName, contractOverride]) => {
          if (!contractOverride) return;

          // Make sure network matches an element in config.networks
          const network = config.networks[networkName];
          if (!network)
            throw Error(
              'Contract network does not match a network in "networks"',
            );

          // Validate the address / factory data
          const resolvedFactory =
            ("factory" in contractOverride && contractOverride.factory) ||
            ("factory" in contract && contract.factory);
          const resolvedAddress =
            ("address" in contractOverride && contractOverride.address) ||
            ("address" in contract && contract.address);
          if (resolvedFactory && resolvedAddress)
            throw Error("Factory and address cannot both be defined");
        },
      );
    }
  });

  return config;
};
