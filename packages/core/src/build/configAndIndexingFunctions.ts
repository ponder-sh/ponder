import path from "node:path";
import { BuildError } from "@/common/errors.js";
import type { Options } from "@/common/options.js";
import type { Config } from "@/config/config.js";
import type { DatabaseConfig } from "@/config/database.js";
import {
  type Network,
  getFinalityBlockCount,
  getRpcUrlsForClient,
  isRpcUrlPublic,
} from "@/config/networks.js";
import { buildAbiEvents, buildAbiFunctions, buildTopics } from "@/sync/abi.js";
import type { BlockSource, ContractSource } from "@/sync/source.js";
import { chains } from "@/utils/chains.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { dedupe } from "@ponder/common";
import parse from "pg-connection-string";
import type { Hex, LogTopic } from "viem";
import { buildLogFactory } from "./factory.js";

export type RawIndexingFunctions = {
  name: string;
  fn: (...args: any) => any;
}[];

export type IndexingFunctions = {
  [eventName: string]: (...args: any) => any;
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
  sources: (BlockSource | ContractSource)[];
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

  // Validate and build indexing functions
  let indexingFunctionCount = 0;
  const indexingFunctions: IndexingFunctions = {};

  for (const { name: eventName, fn } of rawIndexingFunctions) {
    const eventNameComponents = eventName.includes(".")
      ? eventName.split(".")
      : eventName.split(":");
    const [sourceName, sourceEventName] = eventNameComponents;
    if (eventNameComponents.length !== 2 || !sourceName || !sourceEventName) {
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
      ...(config.blocks ?? {}),
    }).find((_sourceName) => _sourceName === sourceName);

    if (!matchedSourceName) {
      // Multi-network has N sources, but the hint here should not have duplicates.
      const uniqueSourceNames = dedupe(
        Object.keys({ ...(config.contracts ?? {}), ...(config.blocks ?? {}) }),
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

  const contractSources: ContractSource[] = Object.entries(
    config.contracts ?? {},
  )
    // First, apply any network-specific overrides and flatten the result.
    .flatMap(([contractName, contract]) => {
      if (contract.network === null || contract.network === undefined) {
        throw new Error(
          `Validation failed: Network for contract '${contractName}' is null or undefined. Expected one of [${networks
            .map((n) => `'${n.name}'`)
            .join(", ")}].`,
        );
      }

      const startBlockMaybeNan = contract.startBlock ?? 0;
      const startBlock = Number.isNaN(startBlockMaybeNan)
        ? 0
        : startBlockMaybeNan;
      const endBlockMaybeNan = contract.endBlock;
      const endBlock = Number.isNaN(endBlockMaybeNan)
        ? undefined
        : endBlockMaybeNan;

      if (endBlock !== undefined && endBlock < startBlock) {
        throw new Error(
          `Validation failed: Start block for contract '${contractName}' is after end block (${startBlock} > ${endBlock}).`,
        );
      }

      // Single network case.
      if (typeof contract.network === "string") {
        return {
          id: `log_${contractName}_${contract.network}`,
          name: contractName,
          networkName: contract.network,
          abi: contract.abi,

          address: "address" in contract ? contract.address : undefined,
          factory: "factory" in contract ? contract.factory : undefined,
          filter: contract.filter,

          includeTransactionReceipts:
            contract.includeTransactionReceipts ?? false,
          includeCallTraces: contract.includeCallTraces ?? false,

          startBlock,
          endBlock,
        };
      }

      type DefinedNetworkOverride = NonNullable<
        Exclude<Config["contracts"][string]["network"], string>[string]
      >;

      // Multiple networks case.
      return Object.entries(contract.network)
        .filter((n): n is [string, DefinedNetworkOverride] => !!n[1])
        .map(([networkName, overrides]) => {
          const startBlockMaybeNan =
            overrides.startBlock ?? contract.startBlock ?? 0;
          const startBlock = Number.isNaN(startBlockMaybeNan)
            ? 0
            : startBlockMaybeNan;
          const endBlockMaybeNan = overrides.endBlock ?? contract.endBlock;
          const endBlock = Number.isNaN(endBlockMaybeNan)
            ? undefined
            : endBlockMaybeNan;

          if (endBlock !== undefined && endBlock < startBlock) {
            throw new Error(
              `Validation failed: Start block for contract '${contractName}' is after end block (${startBlock} > ${endBlock}).`,
            );
          }

          return {
            name: contractName,
            networkName,
            abi: contract.abi,

            address:
              ("address" in overrides ? overrides?.address : undefined) ??
              ("address" in contract ? contract.address : undefined),
            factory:
              ("factory" in overrides ? overrides.factory : undefined) ??
              ("factory" in contract ? contract.factory : undefined),
            filter: overrides.filter ?? contract.filter,

            includeTransactionReceipts:
              overrides.includeTransactionReceipts ??
              contract.includeTransactionReceipts ??
              false,
            includeCallTraces:
              overrides.includeCallTraces ??
              contract.includeCallTraces ??
              false,

            startBlock,
            endBlock,
          };
        });
    })
    // Second, build and validate the factory or log source.
    .flatMap((rawContract): ContractSource[] => {
      const network = networks.find((n) => n.name === rawContract.networkName);
      if (!network) {
        throw new Error(
          `Validation failed: Invalid network for contract '${
            rawContract.name
          }'. Got '${rawContract.networkName}', expected one of [${networks
            .map((n) => `'${n.name}'`)
            .join(", ")}].`,
        );
      }

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
          if (
            logContractName === rawContract.name &&
            logEventName !== "setup"
          ) {
            registeredLogEvents.push(logEventName);
          }
        }

        // call trace event
        if (eventName.includes(".")) {
          const [functionContractName, functionName] = eventName.split(".") as [
            string,
            string,
          ];
          if (functionContractName === rawContract.name) {
            registeredCallTraceEvents.push(functionName);
          }
        }
      }

      // Note: This can probably throw for invalid ABIs. Consider adding explicit ABI validation before this line.
      const abiEvents = buildAbiEvents({ abi: rawContract.abi });
      const abiFunctions = buildAbiFunctions({ abi: rawContract.abi });

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

      let topics: LogTopic[] = [registeredEventSelectors];

      if (rawContract.filter !== undefined) {
        if (
          Array.isArray(rawContract.filter.event) &&
          rawContract.filter.args !== undefined
        ) {
          throw new Error(
            `Validation failed: Event filter for contract '${rawContract.name}' cannot contain indexed argument values if multiple events are provided.`,
          );
        }

        const filterSafeEventNames = Array.isArray(rawContract.filter.event)
          ? rawContract.filter.event
          : [rawContract.filter.event];

        for (const filterSafeEventName of filterSafeEventNames) {
          const abiEvent = abiEvents.bySafeName[filterSafeEventName];
          if (!abiEvent) {
            throw new Error(
              `Validation failed: Invalid filter for contract '${
                rawContract.name
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
        const [topic0FromFilter, ...topicsFromFilter] = buildTopics(
          rawContract.abi,
          rawContract.filter,
        ) as [Exclude<LogTopic, null>, ...LogTopic[]];

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
                rawContract.name
              }'. Got '${logEventName}', expected one of [${filteredEventSelectors
                .map((s) => abiEvents.bySelector[s]!.safeName)
                .map((eventName) => `'${eventName}'`)
                .join(", ")}].`,
            );
          }
        }

        topics = [registeredEventSelectors, ...topicsFromFilter];
      }

      const contractMetadata = {
        type: "contract",
        abi: rawContract.abi,
        abiEvents,
        abiFunctions,
        name: rawContract.name,
        networkName: rawContract.networkName,
      } as const;

      const resolvedFactory = rawContract?.factory;
      const resolvedAddress = rawContract?.address;

      if (resolvedFactory !== undefined && resolvedAddress !== undefined) {
        throw new Error(
          `Validation failed: Contract '${contractMetadata.name}' cannot specify both 'factory' and 'address' options.`,
        );
      }

      if (resolvedFactory) {
        // Note that this can throw.
        const logFactory = buildLogFactory({
          chainId: network.chainId,
          ...resolvedFactory,
        });

        const logSource = {
          ...contractMetadata,
          filter: {
            type: "log",
            chainId: network.chainId,
            address: logFactory,
            topics,
            includeTransactionReceipts: rawContract.includeTransactionReceipts,
            fromBlock: rawContract.startBlock,
            toBlock: rawContract.endBlock,
          },
        } satisfies ContractSource;

        if (rawContract.includeCallTraces) {
          return [
            logSource,
            {
              ...contractMetadata,
              filter: {
                type: "callTrace",
                chainId: network.chainId,
                fromAddress: undefined,
                toAddress: logFactory,
                functionSelectors: registeredFunctionSelectors,
                includeTransactionReceipts:
                  rawContract.includeTransactionReceipts,
                fromBlock: rawContract.startBlock,
                toBlock: rawContract.endBlock,
              },
            } satisfies ContractSource,
          ];
        }

        return [logSource];
      }

      if (resolvedAddress !== undefined) {
        for (const address of Array.isArray(resolvedAddress)
          ? resolvedAddress
          : [resolvedAddress]) {
          if (!address.startsWith("0x"))
            throw new Error(
              `Validation failed: Invalid prefix for address '${address}'. Got '${address.slice(
                0,
                2,
              )}', expected '0x'.`,
            );
          if (address.length !== 42)
            throw new Error(
              `Validation failed: Invalid length for address '${address}'. Got ${address.length}, expected 42 characters.`,
            );
        }
      }

      const validatedAddress = Array.isArray(resolvedAddress)
        ? resolvedAddress.map((r) => toLowerCase(r))
        : resolvedAddress !== undefined
          ? toLowerCase(resolvedAddress)
          : undefined;

      const logSource = {
        ...contractMetadata,
        filter: {
          type: "log",
          chainId: network.chainId,
          address: validatedAddress,
          topics,
          includeTransactionReceipts: rawContract.includeTransactionReceipts,
          fromBlock: rawContract.startBlock,
          toBlock: rawContract.endBlock,
        },
      } satisfies ContractSource;

      if (rawContract.includeCallTraces) {
        return [
          logSource,
          {
            ...contractMetadata,
            filter: {
              type: "callTrace",
              chainId: network.chainId,
              fromAddress: undefined,
              toAddress: Array.isArray(validatedAddress)
                ? validatedAddress
                : validatedAddress === undefined
                  ? undefined
                  : [validatedAddress],
              functionSelectors: registeredFunctionSelectors,
              includeTransactionReceipts:
                rawContract.includeTransactionReceipts,
              fromBlock: rawContract.startBlock,
              toBlock: rawContract.endBlock,
            },
          } satisfies ContractSource,
        ];
      } else return [logSource];
    })
    // Remove sources with no registered indexing functions
    .filter((source) => {
      const hasRegisteredIndexingFunctions =
        source.filter.type === "callTrace"
          ? source.filter.functionSelectors.length !== 0
          : source.filter.topics[0]?.length !== 0;
      if (!hasRegisteredIndexingFunctions) {
        logs.push({
          level: "debug",
          msg: `No indexing functions were registered for '${
            source.name
          }' ${source.filter.type === "callTrace" ? "call traces" : "logs"}`,
        });
      }
      return hasRegisteredIndexingFunctions;
    });

  const blockSources: BlockSource[] = Object.entries(config.blocks ?? {})
    .flatMap(([sourceName, blockSourceConfig]) => {
      const startBlockMaybeNan = blockSourceConfig.startBlock ?? 0;
      const startBlock = Number.isNaN(startBlockMaybeNan)
        ? 0
        : startBlockMaybeNan;
      const endBlockMaybeNan = blockSourceConfig.endBlock;
      const endBlock = Number.isNaN(endBlockMaybeNan)
        ? undefined
        : endBlockMaybeNan;

      if (endBlock !== undefined && endBlock < startBlock) {
        throw new Error(
          `Validation failed: Start block for block source '${sourceName}' is after end block (${startBlock} > ${endBlock}).`,
        );
      }

      if (typeof blockSourceConfig.network === "string") {
        const network = networks.find(
          (n) => n.name === blockSourceConfig.network,
        );
        if (!network) {
          throw new Error(
            `Validation failed: Invalid network for block source '${sourceName}'. Got '${
              blockSourceConfig.network
            }', expected one of [${networks.map((n) => `'${n.name}'`).join(", ")}].`,
          );
        }

        const intervalMaybeNan = blockSourceConfig.interval ?? 1;
        const interval = Number.isNaN(intervalMaybeNan) ? 0 : intervalMaybeNan;

        if (!Number.isInteger(interval) || interval === 0) {
          throw new Error(
            `Validation failed: Invalid interval for block source '${sourceName}'. Got ${interval}, expected a non-zero integer.`,
          );
        }

        return {
          type: "block",
          name: sourceName,
          networkName: blockSourceConfig.network,
          filter: {
            type: "block",
            chainId: network.chainId,
            interval: interval,
            offset: startBlock % interval,
            fromBlock: startBlock,
            toBlock: endBlock,
          },
        } satisfies BlockSource;
      }

      type DefinedNetworkOverride = NonNullable<
        Exclude<Config["blocks"][string]["network"], string>[string]
      >;

      return Object.entries(blockSourceConfig.network)
        .filter((n): n is [string, DefinedNetworkOverride] => !!n[1])
        .map(([networkName, overrides]) => {
          const network = networks.find((n) => n.name === networkName);
          if (!network) {
            throw new Error(
              `Validation failed: Invalid network for block source '${sourceName}'. Got '${networkName}', expected one of [${networks
                .map((n) => `'${n.name}'`)
                .join(", ")}].`,
            );
          }

          const startBlockMaybeNan =
            overrides.startBlock ?? blockSourceConfig.startBlock ?? 0;
          const startBlock = Number.isNaN(startBlockMaybeNan)
            ? 0
            : startBlockMaybeNan;
          const endBlockMaybeNan =
            overrides.endBlock ?? blockSourceConfig.endBlock;
          const endBlock = Number.isNaN(endBlockMaybeNan)
            ? undefined
            : endBlockMaybeNan;

          if (endBlock !== undefined && endBlock < startBlock) {
            throw new Error(
              `Validation failed: Start block for block source '${sourceName}' is after end block (${startBlock} > ${endBlock}).`,
            );
          }

          const intervalMaybeNan =
            overrides.interval ?? blockSourceConfig.interval ?? 0;
          const interval = Number.isNaN(intervalMaybeNan)
            ? 0
            : intervalMaybeNan;

          if (!Number.isInteger(interval) || interval === 0) {
            throw new Error(
              `Validation failed: Invalid interval for block source '${sourceName}'. Got ${interval}, expected a non-zero integer.`,
            );
          }

          return {
            type: "block",
            name: sourceName,
            networkName,
            filter: {
              type: "block",
              chainId: network.chainId,
              interval: interval,
              offset: startBlock % interval,
              fromBlock: startBlock,
              toBlock: endBlock,
            },
          } satisfies BlockSource;
        });
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

  const sources = [...contractSources, ...blockSources];

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
