import path from "node:path";
import { BuildError } from "@/common/errors.js";
import type { Options } from "@/common/options.js";
import type { Factory } from "@/config/address.js";
import type { Config } from "@/config/config.js";
import type { DatabaseConfig } from "@/config/database.js";
import {
  type Network,
  getFinalityBlockCount,
  getRpcUrlsForClient,
  isRpcUrlPublic,
} from "@/config/networks.js";
import { buildAbiEvents, buildAbiFunctions, buildTopics } from "@/sync/abi.js";
import type {
  AccountSource,
  BlockSource,
  ContractSource,
  Source,
} from "@/sync/source.js";
import { chains } from "@/utils/chains.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { dedupe } from "@ponder/common";
import parse from "pg-connection-string";
import type { Address, Hex, LogTopic } from "viem";
import { buildLogFactory } from "./factory.js";

export type RawIndexingFunctions = {
  name: string;
  fn: (...args: any) => any;
}[];

export type IndexingFunctions = {
  [eventName: string]: (...args: any) => any;
};

const flattenSource = <
  T extends Config["contracts"] | Config["accounts"] | Config["blocks"],
>(
  config: T,
): (Omit<T[string], "network"> & { name: string; network: string })[] => {
  return Object.entries(config).flatMap(
    ([name, source]: [string, T[string]]) => {
      if (typeof source.network === "string") {
        return {
          name,
          ...source,
        };
      } else {
        return Object.entries(source.network).map(
          ([network, sourceOverride]) => {
            const { network: _network, ...base } = source;

            return {
              name,
              network,
              ...base,
              ...sourceOverride,
            };
          },
        );
      }
    },
  );
};

export async function buildConfigAndIndexingFunctions({
  config,
  rawIndexingFunctions,
  options: { rootDir, ponderDir },
}: {
  config: Config;
  rawIndexingFunctions: RawIndexingFunctions;
  options: Pick<Options, "ponderDir" | "rootDir">;
}): Promise<{
  databaseConfig: DatabaseConfig;
  networks: Network[];
  sources: Source[];
  indexingFunctions: IndexingFunctions;
  logs: { level: "warn" | "info" | "debug"; msg: string }[];
}> {
  const logs: { level: "warn" | "info" | "debug"; msg: string }[] = [];

  // Build database.
  let databaseConfig: DatabaseConfig;

  // Determine PGlite directory, preferring config.database.directory if available
  const pgliteDir =
    config.database?.kind === "pglite" && config.database.directory
      ? config.database.directory === "memory://"
        ? "memory://"
        : path.resolve(config.database.directory)
      : path.join(ponderDir, "pglite");

  const pglitePrintPath =
    pgliteDir === "memory://" ? "memory://" : path.relative(rootDir, pgliteDir);

  if (config.database?.kind) {
    if (config.database.kind === "postgres") {
      let connectionString: string | undefined = undefined;
      let source: string | undefined = undefined;

      if (config.database.connectionString) {
        connectionString = config.database.connectionString;
        source = "from ponder.config.ts";
      } else if (process.env.DATABASE_PRIVATE_URL) {
        connectionString = process.env.DATABASE_PRIVATE_URL;
        source = "from DATABASE_PRIVATE_URL env var";
      } else if (process.env.DATABASE_URL) {
        connectionString = process.env.DATABASE_URL;
        source = "from DATABASE_URL env var";
      } else {
        throw new Error(
          `Invalid database configuration: 'kind' is set to 'postgres' but no connection string was provided.`,
        );
      }

      logs.push({
        level: "info",
        msg: `Using Postgres database '${getDatabaseName(connectionString)}' (${source})`,
      });

      const poolConfig = {
        max: config.database.poolConfig?.max ?? 30,
        connectionString,
      };

      databaseConfig = { kind: "postgres", poolConfig };
    } else {
      logs.push({
        level: "info",
        msg: `Using PGlite database in '${pglitePrintPath}' (from ponder.config.ts)`,
      });

      databaseConfig = { kind: "pglite", options: { dataDir: pgliteDir } };
    }
  } else {
    let connectionString: string | undefined = undefined;
    let source: string | undefined = undefined;
    if (process.env.DATABASE_PRIVATE_URL) {
      connectionString = process.env.DATABASE_PRIVATE_URL;
      source = "from DATABASE_PRIVATE_URL env var";
    } else if (process.env.DATABASE_URL) {
      connectionString = process.env.DATABASE_URL;
      source = "from DATABASE_URL env var";
    }

    // If either of the DATABASE_URL env vars are set, use Postgres.
    if (connectionString !== undefined) {
      logs.push({
        level: "info",
        msg: `Using Postgres database ${getDatabaseName(connectionString)} (${source})`,
      });

      const poolConfig = { max: 30, connectionString };

      databaseConfig = { kind: "postgres", poolConfig };
    } else {
      // Fall back to PGlite.
      logs.push({
        level: "info",
        msg: `Using PGlite database at ${pglitePrintPath} (default)`,
      });

      databaseConfig = { kind: "pglite", options: { dataDir: pgliteDir } };
    }
  }

  const networks: Network[] = await Promise.all(
    Object.entries(config.networks).map(async ([networkName, network]) => {
      const { chainId, transport } = network;

      const defaultChain =
        Object.values(chains).find((c) =>
          "id" in c ? c.id === chainId : false,
        ) ?? chains.mainnet!;
      const chain = { ...defaultChain, name: networkName, id: chainId };

      // Note: This can throw.
      const rpcUrls = await getRpcUrlsForClient({ transport, chain });
      rpcUrls.forEach((rpcUrl) => {
        if (isRpcUrlPublic(rpcUrl)) {
          logs.push({
            level: "warn",
            msg: `Network '${networkName}' is using a public RPC URL (${rpcUrl}). Most apps require an RPC URL with a higher rate limit.`,
          });
        }
      });

      if (
        network.pollingInterval !== undefined &&
        network.pollingInterval! < 100
      ) {
        throw new Error(
          `Invalid 'pollingInterval' for network '${networkName}. Expected 100 milliseconds or greater, got ${network.pollingInterval} milliseconds.`,
        );
      }

      return {
        name: networkName,
        chainId,
        chain,
        transport: network.transport({ chain }),
        maxRequestsPerSecond: network.maxRequestsPerSecond ?? 50,
        pollingInterval: network.pollingInterval ?? 1_000,
        finalityBlockCount: getFinalityBlockCount({ chainId }),
        disableCache: network.disableCache ?? false,
      } satisfies Network;
    }),
  );

  const sourceNames = new Set<string>();
  for (const source of [
    ...Object.keys(config.contracts ?? {}),
    ...Object.keys(config.accounts ?? {}),
    ...Object.keys(config.blocks ?? {}),
  ]) {
    if (sourceNames.has(source)) {
      throw new Error(
        `Validation failed: Duplicate source name '${source}' not allowed.`,
      );
    }
    sourceNames.add(source);
  }

  // Validate and build indexing functions
  let indexingFunctionCount = 0;
  const indexingFunctions: IndexingFunctions = {};

  for (const { name: eventName, fn } of rawIndexingFunctions) {
    const eventNameComponents = eventName.includes(".")
      ? eventName.split(".")
      : eventName.split(":");

    const [sourceName] = eventNameComponents;

    if (!sourceName) {
      throw new Error(
        `Validation failed: Invalid event '${eventName}', expected format '{sourceName}:{eventName}' or '{sourceName}.{eventName}'.`,
      );
    }

    if (eventNameComponents.length === 3) {
      const [, sourceType, fromOrTo] = eventNameComponents;

      if (
        (sourceType !== "transaction" && sourceType !== "transfer") ||
        (fromOrTo !== "from" && fromOrTo !== "to")
      ) {
        throw new Error(
          `Validation failed: Invalid event '${eventName}', expected format '{sourceName}:transaction:from', '{sourceName}:transaction:to', '{sourceName}:transfer:from', or '{sourceName}:transfer:to'.`,
        );
      }
    } else if (eventNameComponents.length === 2) {
      const [, sourceEventName] = eventNameComponents;

      if (!sourceEventName) {
        throw new Error(
          `Validation failed: Invalid event '${eventName}', expected format '{sourceName}:{eventName}' or '{sourceName}.{eventName}'.`,
        );
      }
    } else {
      throw new Error(
        `Validation failed: Invalid event '${eventName}', expected format '{sourceName}:{eventName}' or '{sourceName}.{eventName}'.`,
      );
    }

    if (eventName in indexingFunctions) {
      throw new Error(
        `Validation failed: Multiple indexing functions registered for event '${eventName}'.`,
      );
    }

    // Validate that the indexing function uses a sourceName that is present in the config.
    const matchedSourceName = Object.keys({
      ...(config.contracts ?? {}),
      ...(config.accounts ?? {}),
      ...(config.blocks ?? {}),
    }).find((_sourceName) => _sourceName === sourceName);

    if (!matchedSourceName) {
      // Multi-network has N sources, but the hint here should not have duplicates.
      const uniqueSourceNames = dedupe(
        Object.keys({
          ...(config.contracts ?? {}),
          ...(config.accounts ?? {}),
          ...(config.blocks ?? {}),
        }),
      );
      throw new Error(
        `Validation failed: Invalid source name '${sourceName}'. Got '${sourceName}', expected one of [${uniqueSourceNames
          .map((n) => `'${n}'`)
          .join(", ")}].`,
      );
    }

    indexingFunctions[eventName] = fn;
    indexingFunctionCount += 1;
  }

  if (indexingFunctionCount === 0) {
    logs.push({ level: "warn", msg: "No indexing functions were registered." });
  }

  // common validation for all sources
  for (const source of [
    ...flattenSource(config.contracts ?? {}),
    ...flattenSource(config.accounts ?? {}),
    ...flattenSource(config.blocks ?? {}),
  ]) {
    if (source.network === null || source.network === undefined) {
      throw new Error(
        `Validation failed: Network for '${source.name}' is null or undefined. Expected one of [${networks
          .map((n) => `'${n.name}'`)
          .join(", ")}].`,
      );
    }

    const startBlockMaybeNan = source.startBlock;
    const startBlock = Number.isNaN(startBlockMaybeNan)
      ? undefined
      : startBlockMaybeNan;
    const endBlockMaybeNan = source.endBlock;
    const endBlock = Number.isNaN(endBlockMaybeNan)
      ? undefined
      : endBlockMaybeNan;

    if (
      startBlock !== undefined &&
      endBlock !== undefined &&
      endBlock < startBlock
    ) {
      throw new Error(
        `Validation failed: Start block for '${source.name}' is after end block (${startBlock} > ${endBlock}).`,
      );
    }

    const network = networks.find((n) => n.name === source.network);
    if (!network) {
      throw new Error(
        `Validation failed: Invalid network for '${
          source.name
        }'. Got '${source.network}', expected one of [${networks
          .map((n) => `'${n.name}'`)
          .join(", ")}].`,
      );
    }
  }

  const contractSources: ContractSource[] = flattenSource(
    config.contracts ?? {},
  )
    .flatMap((source): ContractSource[] => {
      const network = networks.find((n) => n.name === source.network)!;

      // Get indexing function that were registered for this contract
      const registeredLogEvents: string[] = [];
      const registeredCallTraceEvents: string[] = [];
      for (const eventName of Object.keys(indexingFunctions)) {
        // log event
        if (eventName.includes(":")) {
          const [logContractName, logEventName] = eventName.split(":") as [
            string,
            string,
          ];
          if (logContractName === source.name && logEventName !== "setup") {
            registeredLogEvents.push(logEventName);
          }
        }

        //  trace event
        if (eventName.includes(".")) {
          const [functionContractName, functionName] = eventName.split(".") as [
            string,
            string,
          ];
          if (functionContractName === source.name) {
            registeredCallTraceEvents.push(functionName);
          }
        }
      }

      // Note: This can probably throw for invalid ABIs. Consider adding explicit ABI validation before this line.
      const abiEvents = buildAbiEvents({ abi: source.abi });
      const abiFunctions = buildAbiFunctions({ abi: source.abi });

      const registeredEventSelectors: Hex[] = [];
      // Validate that the registered log events exist in the abi
      for (const logEvent of registeredLogEvents) {
        const abiEvent = abiEvents.bySafeName[logEvent];
        if (abiEvent === undefined) {
          throw new Error(
            `Validation failed: Event name for event '${logEvent}' not found in the contract ABI. Got '${logEvent}', expected one of [${Object.keys(
              abiEvents.bySafeName,
            )
              .map((eventName) => `'${eventName}'`)
              .join(", ")}].`,
          );
        }

        registeredEventSelectors.push(abiEvent.selector);
      }

      const registeredFunctionSelectors: Hex[] = [];
      for (const _function of registeredCallTraceEvents) {
        const abiFunction = abiFunctions.bySafeName[_function];
        if (abiFunction === undefined) {
          throw new Error(
            `Validation failed: Function name for function '${_function}' not found in the contract ABI. Got '${_function}', expected one of [${Object.keys(
              abiFunctions.bySafeName,
            )
              .map((eventName) => `'${eventName}'`)
              .join(", ")}].`,
          );
        }

        registeredFunctionSelectors.push(abiFunction.selector);
      }

      let topic0: LogTopic = registeredEventSelectors;
      let topic1: LogTopic = null;
      let topic2: LogTopic = null;
      let topic3: LogTopic = null;

      if (source.filter !== undefined) {
        if (
          Array.isArray(source.filter.event) &&
          source.filter.args !== undefined
        ) {
          throw new Error(
            `Validation failed: Event filter for contract '${source.name}' cannot contain indexed argument values if multiple events are provided.`,
          );
        }

        const filterSafeEventNames = Array.isArray(source.filter.event)
          ? source.filter.event
          : [source.filter.event];

        for (const filterSafeEventName of filterSafeEventNames) {
          const abiEvent = abiEvents.bySafeName[filterSafeEventName];
          if (!abiEvent) {
            throw new Error(
              `Validation failed: Invalid filter for contract '${
                source.name
              }'. Got event name '${filterSafeEventName}', expected one of [${Object.keys(
                abiEvents.bySafeName,
              )
                .map((n) => `'${n}'`)
                .join(", ")}].`,
            );
          }
        }

        // TODO: Explicit validation of indexed argument value format (array or object).
        // The first element of the array return from `buildTopics` being defined
        // is an invariant of the current filter design.
        // Note: This can throw.

        const topics = buildTopics(source.abi, source.filter);
        const topic0FromFilter = topics.topic0;
        topic1 = topics.topic1;
        topic2 = topics.topic2;
        topic3 = topics.topic3;

        const filteredEventSelectors = Array.isArray(topic0FromFilter)
          ? topic0FromFilter
          : [topic0FromFilter];

        // Validate that the topic0 value defined by the `eventFilter` is a superset of the
        // registered indexing functions. Simply put, confirm that no indexing function is
        // defined for a log event that is excluded by the filter.
        for (const registeredEventSelector of registeredEventSelectors) {
          if (!filteredEventSelectors.includes(registeredEventSelector)) {
            const logEventName =
              abiEvents.bySelector[registeredEventSelector]!.safeName;

            throw new Error(
              `Validation failed: Event '${logEventName}' is excluded by the event filter defined on the contract '${
                source.name
              }'. Got '${logEventName}', expected one of [${filteredEventSelectors
                .map((s) => abiEvents.bySelector[s]!.safeName)
                .map((eventName) => `'${eventName}'`)
                .join(", ")}].`,
            );
          }
        }

        topic0 = registeredEventSelectors;
      }

      const startBlockMaybeNan = source.startBlock;
      const fromBlock = Number.isNaN(startBlockMaybeNan)
        ? undefined
        : startBlockMaybeNan;
      const endBlockMaybeNan = source.endBlock;
      const toBlock = Number.isNaN(endBlockMaybeNan)
        ? undefined
        : endBlockMaybeNan;

      const contractMetadata = {
        type: "contract",
        abi: source.abi,
        abiEvents,
        abiFunctions,
        name: source.name,
        networkName: source.network,
      } as const;

      const resolvedAddress = source?.address;

      if (typeof resolvedAddress === "object") {
        // Note that this can throw.
        const logFactory = buildLogFactory({
          chainId: network.chainId,
          ...(resolvedAddress as Factory),
        });

        const logSource = {
          ...contractMetadata,
          filter: {
            type: "log",
            chainId: network.chainId,
            address: logFactory,
            topic0,
            topic1,
            topic2,
            topic3,
            // includeTransactionReceipts: source.includeTransactionReceipts,
            fromBlock,
            toBlock,
          },
        } satisfies ContractSource;

        if (source.includeCallTraces) {
          return [
            logSource,
            {
              ...contractMetadata,
              filter: {
                type: "trace",
                chainId: network.chainId,
                fromAddress: undefined,
                toAddress: logFactory,
                callType: "CALL",
                functionSelector: registeredFunctionSelectors,
                includeReverted: false,
                // includeTransactionReceipts:
                //   rawContract.includeTransactionReceipts,
                fromBlock,
                toBlock,
              },
            } satisfies ContractSource,
          ];
        }

        return [logSource];
      } else if (resolvedAddress !== undefined) {
        for (const address of Array.isArray(resolvedAddress)
          ? resolvedAddress
          : [resolvedAddress]) {
          if (!address!.startsWith("0x"))
            throw new Error(
              `Validation failed: Invalid prefix for address '${address}'. Got '${address!.slice(
                0,
                2,
              )}', expected '0x'.`,
            );
          if (address!.length !== 42)
            throw new Error(
              `Validation failed: Invalid length for address '${address}'. Got ${address!.length}, expected 42 characters.`,
            );
        }
      }

      const validatedAddress = Array.isArray(resolvedAddress)
        ? (resolvedAddress.map((r) => toLowerCase(r)) as Address[])
        : resolvedAddress !== undefined
          ? (toLowerCase(resolvedAddress) as Address)
          : undefined;

      const logSource = {
        ...contractMetadata,
        filter: {
          type: "log",
          chainId: network.chainId,
          address: validatedAddress,
          topic0,
          topic1,
          topic2,
          topic3,
          // includeTransactionReceipts: rawContract.includeTransactionReceipts,
          fromBlock,
          toBlock,
        },
      } satisfies ContractSource;

      if (source.includeCallTraces) {
        return [
          logSource,
          {
            ...contractMetadata,
            filter: {
              type: "trace",
              chainId: network.chainId,
              fromAddress: undefined,
              toAddress: Array.isArray(validatedAddress)
                ? validatedAddress
                : validatedAddress === undefined
                  ? undefined
                  : [validatedAddress],
              callType: "CALL",
              functionSelector: registeredFunctionSelectors,
              includeReverted: false,
              // includeTransactionReceipts:
              //   rawContract.includeTransactionReceipts,
              fromBlock,
              toBlock,
            },
          } satisfies ContractSource,
        ];
      } else return [logSource];
    }) // Remove sources with no registered indexing functions
    .filter((source) => {
      const hasRegisteredIndexingFunctions =
        source.filter.type === "trace"
          ? Array.isArray(source.filter.functionSelector) &&
            source.filter.functionSelector.length > 0
          : Array.isArray(source.filter.topic0) &&
            source.filter.topic0?.length > 0;
      if (!hasRegisteredIndexingFunctions) {
        logs.push({
          level: "debug",
          msg: `No indexing functions were registered for '${
            source.name
          }' ${source.filter.type === "trace" ? "traces" : "logs"}`,
        });
      }
      return hasRegisteredIndexingFunctions;
    });

  const accountSources: AccountSource[] = flattenSource(config.accounts ?? {})
    .flatMap((source): AccountSource[] => {
      const network = networks.find((n) => n.name === source.network)!;

      const startBlockMaybeNan = source.startBlock;
      const fromBlock = Number.isNaN(startBlockMaybeNan)
        ? undefined
        : startBlockMaybeNan;
      const endBlockMaybeNan = source.endBlock;
      const toBlock = Number.isNaN(endBlockMaybeNan)
        ? undefined
        : endBlockMaybeNan;

      const resolvedAddress = source?.address;

      if (typeof resolvedAddress === "object") {
        // Note that this can throw.
        const logFactory = buildLogFactory({
          chainId: network.chainId,
          ...(resolvedAddress as Factory),
        });

        return [
          {
            type: "account",
            name: source.name,
            networkName: source.network,
            filter: {
              type: "transaction",
              chainId: network.chainId,
              fromAddress: undefined,
              toAddress: logFactory,
              includeReverted: false,
              fromBlock,
              toBlock,
            },
          } satisfies AccountSource,
          {
            type: "account",
            name: source.name,
            networkName: source.network,
            filter: {
              type: "transaction",
              chainId: network.chainId,
              fromAddress: logFactory,
              toAddress: undefined,
              includeReverted: false,
              fromBlock,
              toBlock,
            },
          } satisfies AccountSource,
          {
            type: "account",
            name: source.name,
            networkName: source.network,
            filter: {
              type: "transfer",
              chainId: network.chainId,
              fromAddress: undefined,
              toAddress: logFactory,
              includeReverted: false,
              fromBlock,
              toBlock,
            },
          } satisfies AccountSource,
          {
            type: "account",
            name: source.name,
            networkName: source.network,
            filter: {
              type: "transfer",
              chainId: network.chainId,
              fromAddress: logFactory,
              toAddress: undefined,
              includeReverted: false,
              fromBlock,
              toBlock,
            },
          } satisfies AccountSource,
        ];
      }

      for (const address of Array.isArray(resolvedAddress)
        ? resolvedAddress
        : [resolvedAddress]) {
        if (!address!.startsWith("0x"))
          throw new Error(
            `Validation failed: Invalid prefix for address '${address}'. Got '${address!.slice(
              0,
              2,
            )}', expected '0x'.`,
          );
        if (address!.length !== 42)
          throw new Error(
            `Validation failed: Invalid length for address '${address}'. Got ${address!.length}, expected 42 characters.`,
          );
      }

      const validatedAddress = Array.isArray(resolvedAddress)
        ? (resolvedAddress.map((r) => toLowerCase(r)) as Address[])
        : resolvedAddress !== undefined
          ? (toLowerCase(resolvedAddress) as Address)
          : undefined;

      return [
        {
          type: "account",
          name: source.name,

          networkName: source.network,
          filter: {
            type: "transaction",
            chainId: network.chainId,
            fromAddress: undefined,
            toAddress: validatedAddress,
            includeReverted: false,
            fromBlock,
            toBlock,
          },
        } satisfies AccountSource,
        {
          type: "account",
          name: source.name,
          networkName: source.network,
          filter: {
            type: "transaction",
            chainId: network.chainId,
            fromAddress: validatedAddress,
            toAddress: undefined,
            includeReverted: false,
            fromBlock,
            toBlock,
          },
        } satisfies AccountSource,
        {
          type: "account",
          name: source.name,
          networkName: source.network,
          filter: {
            type: "transfer",
            chainId: network.chainId,
            fromAddress: undefined,
            toAddress: validatedAddress,
            includeReverted: false,
            fromBlock,
            toBlock,
          },
        } satisfies AccountSource,
        {
          type: "account",
          name: source.name,
          networkName: source.network,
          filter: {
            type: "transfer",
            chainId: network.chainId,
            fromAddress: validatedAddress,
            toAddress: undefined,
            includeReverted: false,
            fromBlock,
            toBlock,
          },
        } satisfies AccountSource,
      ];
    })
    .filter((source) => {
      const eventName =
        source.filter.type === "transaction"
          ? source.filter.fromAddress === undefined
            ? `${source.name}:transaction:to`
            : `${source.name}:transaction:from`
          : source.filter.fromAddress === undefined
            ? `${source.name}:transfer:to`
            : `${source.name}:transfer:from`;

      const hasRegisteredIndexingFunction =
        indexingFunctions[eventName] !== undefined;
      if (!hasRegisteredIndexingFunction) {
        logs.push({
          level: "debug",
          msg: `No indexing functions were registered for '${eventName}'`,
        });
      }
      return hasRegisteredIndexingFunction;
    });

  const blockSources: BlockSource[] = flattenSource(config.blocks ?? {})
    .map((source) => {
      const network = networks.find((n) => n.name === source.network)!;

      const intervalMaybeNan = source.interval ?? 1;
      const interval = Number.isNaN(intervalMaybeNan) ? 0 : intervalMaybeNan;

      if (!Number.isInteger(interval) || interval === 0) {
        throw new Error(
          `Validation failed: Invalid interval for block source '${source.name}'. Got ${interval}, expected a non-zero integer.`,
        );
      }

      const startBlockMaybeNan = source.startBlock;
      const fromBlock = Number.isNaN(startBlockMaybeNan)
        ? undefined
        : startBlockMaybeNan;
      const endBlockMaybeNan = source.endBlock;
      const toBlock = Number.isNaN(endBlockMaybeNan)
        ? undefined
        : endBlockMaybeNan;

      return {
        type: "block",
        name: source.name,
        networkName: source.network,
        filter: {
          type: "block",
          chainId: network.chainId,
          interval: interval,
          offset: (fromBlock ?? 0) % interval,
          fromBlock,
          toBlock,
        },
      } satisfies BlockSource;
    })
    .filter((blockSource) => {
      const hasRegisteredIndexingFunction =
        indexingFunctions[`${blockSource.name}:block`] !== undefined;
      if (!hasRegisteredIndexingFunction) {
        logs.push({
          level: "debug",
          msg: `No indexing functions were registered for '${blockSource.name}' blocks`,
        });
      }
      return hasRegisteredIndexingFunction;
    });

  const sources = [...contractSources, ...accountSources, ...blockSources];

  // Filter out any networks that don't have any sources registered.
  const networksWithSources = networks.filter((network) => {
    const hasSources = sources.some(
      (source) => source.networkName === network.name,
    );
    if (!hasSources) {
      logs.push({
        level: "warn",
        msg: `No sources registered for network '${network.name}'`,
      });
    }
    return hasSources;
  });

  if (Object.keys(indexingFunctions).length === 0) {
    throw new Error(
      "Validation failed: Found 0 registered indexing functions.",
    );
  }

  return {
    databaseConfig,
    networks: networksWithSources,
    sources,
    indexingFunctions,
    logs,
  };
}

export async function safeBuildConfigAndIndexingFunctions({
  config,
  rawIndexingFunctions,
  options,
}: {
  config: Config;
  rawIndexingFunctions: RawIndexingFunctions;
  options: Pick<Options, "rootDir" | "ponderDir">;
}) {
  try {
    const result = await buildConfigAndIndexingFunctions({
      config,
      rawIndexingFunctions,
      options,
    });

    return {
      status: "success",
      sources: result.sources,
      networks: result.networks,
      indexingFunctions: result.indexingFunctions,
      databaseConfig: result.databaseConfig,
      logs: result.logs,
    } as const;
  } catch (_error) {
    const buildError = new BuildError((_error as Error).message);
    buildError.stack = undefined;
    return { status: "error", error: buildError } as const;
  }
}

function getDatabaseName(connectionString: string) {
  const parsed = (parse as unknown as typeof parse.parse)(connectionString);
  return `${parsed.host}:${parsed.port}/${parsed.database}`;
}
