import path from "node:path";
import type { Options } from "@/common/options.js";
import { buildAbiEvents, buildTopics } from "@/config/abi.js";
import type { Config } from "@/config/config.js";
import type { DatabaseConfig } from "@/config/database.js";
import { buildFactoryCriteria } from "@/config/factories.js";
import {
  type Network,
  getDefaultMaxBlockRange,
  getFinalityBlockCount,
  getRpcUrlsForClient,
  isRpcUrlPublic,
} from "@/config/networks.js";
import type {
  BlockSource,
  FactorySource,
  LogSource,
} from "@/config/sources.js";
import { chains } from "@/utils/chains.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { dedupe } from "@ponder/common";
import parse from "pg-connection-string";
import type { Hex, LogTopic } from "viem";

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
  options,
}: {
  config: Config;
  rawIndexingFunctions: RawIndexingFunctions;
  options: Pick<Options, "ponderDir" | "rootDir">;
}) {
  const logs: { level: "warn" | "info" | "debug"; msg: string }[] = [];

  // Build database.
  let databaseConfig: DatabaseConfig;

  const sqliteDir = path.join(options.ponderDir, "sqlite");
  const sqlitePrintPath = path.relative(options.rootDir, sqliteDir);

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
        msg: `Using Postgres database '${getDatabaseName(
          connectionString,
        )}' (${source})`,
      });

      let schema: string | undefined = undefined;
      if (config.database.schema) {
        schema = config.database.schema;
        source = "from ponder.config.ts";
      } else if (process.env.RAILWAY_DEPLOYMENT_ID) {
        if (process.env.RAILWAY_SERVICE_NAME === undefined) {
          throw new Error(
            "Invalid database configuration: RAILWAY_DEPLOYMENT_ID env var is defined, but RAILWAY_SERVICE_NAME env var is not.",
          );
        }
        schema = `${
          process.env.RAILWAY_SERVICE_NAME
        }_${process.env.RAILWAY_DEPLOYMENT_ID.slice(0, 8)}`;
        source = "from RAILWAY_DEPLOYMENT_ID env var";
      } else {
        schema = "public";
        source = "default";
      }
      logs.push({
        level: "info",
        msg: `Using '${schema}' database schema for indexed tables (${source})`,
      });

      let publishSchema: string | undefined = undefined;
      if (config.database.publishSchema !== undefined) {
        publishSchema = config.database.publishSchema;
        source = "from ponder.config.ts";
      } else if (process.env.RAILWAY_DEPLOYMENT_ID !== undefined) {
        publishSchema = "public";
        source = "default for Railway deployment";
      }
      if (publishSchema !== undefined) {
        logs.push({
          level: "info",
          msg: `Using '${publishSchema}' database schema for published views (${source})`,
        });
      } else {
        logs.push({
          level: "debug",
          msg: "Will not publish views (publish schema was not set in ponder.config.ts)",
        });
      }

      if (schema !== undefined && schema === publishSchema) {
        throw new Error(
          `Invalid database configuration: 'publishSchema' cannot be the same as 'schema' ('${schema}').`,
        );
      }

      const poolConfig = {
        max: config.database.poolConfig?.max ?? 30,
        connectionString,
      };

      databaseConfig = {
        kind: "postgres",
        poolConfig,
        schema,
        publishSchema,
      };
    } else {
      logs.push({
        level: "info",
        msg: `Using SQLite database in '${sqlitePrintPath}' (from ponder.config.ts)`,
      });

      databaseConfig = { kind: "sqlite", directory: sqliteDir };
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
        msg: `Using Postgres database ${getDatabaseName(
          connectionString,
        )} (${source})`,
      });

      let schema: string | undefined = undefined;
      if (process.env.RAILWAY_DEPLOYMENT_ID !== undefined) {
        schema = process.env.RAILWAY_DEPLOYMENT_ID;
        if (process.env.RAILWAY_SERVICE_NAME === undefined) {
          throw new Error(
            "Invalid database configuration: RAILWAY_DEPLOYMENT_ID env var is defined, but RAILWAY_SERVICE_NAME env var is not.",
          );
        }
        schema = `${
          process.env.RAILWAY_SERVICE_NAME
        }_${process.env.RAILWAY_DEPLOYMENT_ID.slice(0, 8)}`;
        source = "from RAILWAY_DEPLOYMENT_ID env var";
      } else {
        schema = "public";
        source = "default";
      }
      logs.push({
        level: "info",
        msg: `Using '${schema}' database schema for indexed tables (${source})`,
      });

      let publishSchema: string | undefined = undefined;
      if (process.env.RAILWAY_DEPLOYMENT_ID !== undefined) {
        publishSchema = "public";
        source = "default for Railway deployment";
      }
      if (publishSchema !== undefined) {
        logs.push({
          level: "info",
          msg: `Using '${publishSchema}' database schema for published views (${source})`,
        });
      } else {
        logs.push({
          level: "debug",
          msg: "Will not publish views (publish schema was not set in ponder.config.ts)",
        });
      }

      if (schema !== undefined && schema === publishSchema) {
        throw new Error(
          `Invalid database configuration: 'publishSchema' cannot be the same as 'schema' ('${schema}').`,
        );
      }

      const poolConfig = { max: 30, connectionString };

      databaseConfig = {
        kind: "postgres",
        poolConfig,
        schema,
        publishSchema,
      };
    } else {
      // Fall back to SQLite.
      logs.push({
        level: "info",
        msg: `Using SQLite database at ${sqlitePrintPath} (default)`,
      });

      databaseConfig = { kind: "sqlite", directory: sqliteDir };
    }
  }

  const networks: Network[] = await Promise.all(
    Object.entries(config.networks).map(async ([networkName, network]) => {
      const { chainId, transport } = network;

      const defaultChain =
        Object.values(chains).find((c) =>
          "id" in c ? c.id === chainId : false,
        ) ?? chains.mainnet;
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

      return {
        name: networkName,
        chainId: chainId,
        chain,
        transport: network.transport({ chain }),
        maxRequestsPerSecond: network.maxRequestsPerSecond ?? 50,
        pollingInterval: network.pollingInterval ?? 1_000,
        defaultMaxBlockRange: getDefaultMaxBlockRange({ chainId, rpcUrls }),
        finalityBlockCount: getFinalityBlockCount({ chainId }),
        maxHistoricalTaskConcurrency:
          network.maxHistoricalTaskConcurrency ?? 20,
      } satisfies Network;
    }),
  );

  // Validate and build indexing functions
  let indexingFunctionCount = 0;
  const indexingFunctions: IndexingFunctions = {};

  for (const { name: eventName, fn } of rawIndexingFunctions) {
    const eventNameComponents = eventName.split(":");
    const [sourceName, sourceEventName] = eventNameComponents;
    if (eventNameComponents.length !== 2 || !sourceName || !sourceEventName) {
      throw new Error(
        `Validation failed: Invalid event '${eventName}', expected format '{sourceName}:{eventName}'.`,
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

  const logOrFactorySources: (LogSource | FactorySource)[] = Object.entries(
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

      // Single network case.
      if (typeof contract.network === "string") {
        return {
          id: `${contractName}_${contract.network}`,
          contractName,
          networkName: contract.network,
          abi: contract.abi,

          address: "address" in contract ? contract.address : undefined,
          factory: "factory" in contract ? contract.factory : undefined,
          filter: contract.filter,

          includeTransactionReceipts:
            contract.includeTransactionReceipts ?? false,

          startBlock,
          endBlock,
          maxBlockRange: contract.maxBlockRange,
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

          return {
            id: `${contractName}_${networkName}`,
            contractName,
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

            startBlock,
            endBlock,
            maxBlockRange: overrides.maxBlockRange ?? contract.maxBlockRange,
          };
        });
    })
    // Second, build and validate the factory or log source.
    .map((rawContract) => {
      const network = networks.find((n) => n.name === rawContract.networkName);
      if (!network) {
        throw new Error(
          `Validation failed: Invalid network for contract '${
            rawContract.contractName
          }'. Got '${rawContract.networkName}', expected one of [${networks
            .map((n) => `'${n.name}'`)
            .join(", ")}].`,
        );
      }

      // Get indexing function that were registered for this source
      const registeredLogEvents: string[] = [];
      for (const eventName of Object.keys(indexingFunctions)) {
        const [contractName, logEventName] = eventName.split(":");
        if (
          contractName === rawContract.contractName &&
          logEventName !== "setup"
        ) {
          registeredLogEvents.push(logEventName);
        }
      }

      // Note: This can probably throw for invalid ABIs. Consider adding explicit ABI validation before this line.
      const abiEvents = buildAbiEvents({ abi: rawContract.abi });

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

      let topics: LogTopic[] = [registeredEventSelectors];

      if (rawContract.filter !== undefined) {
        if (
          Array.isArray(rawContract.filter.event) &&
          rawContract.filter.args !== undefined
        ) {
          throw new Error(
            `Validation failed: Event filter for contract '${rawContract.contractName}' cannot contain indexed argument values if multiple events are provided.`,
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
                rawContract.contractName
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
                rawContract.contractName
              }'. Got '${logEventName}', expected one of [${filteredEventSelectors
                .map((s) => abiEvents.bySelector[s]!.safeName)
                .map((eventName) => `'${eventName}'`)
                .join(", ")}].`,
            );
          }
        }

        topics = [registeredEventSelectors, ...topicsFromFilter];
      }

      const baseContract = {
        id: rawContract.id,
        contractName: rawContract.contractName,
        networkName: rawContract.networkName,
        chainId: network.chainId,
        abi: rawContract.abi,
        abiEvents: abiEvents,
        startBlock: rawContract.startBlock,
        endBlock: rawContract.endBlock,
        maxBlockRange: rawContract.maxBlockRange,
      };

      const resolvedFactory = rawContract?.factory;
      const resolvedAddress = rawContract?.address;

      if (resolvedFactory !== undefined && resolvedAddress !== undefined) {
        throw new Error(
          `Validation failed: Contract '${baseContract.contractName}' cannot specify both 'factory' and 'address' options.`,
        );
      }

      if (resolvedFactory) {
        // Note that this can throw.
        const factoryCriteria = buildFactoryCriteria({
          ...resolvedFactory,
          includeTransactionReceipts: rawContract.includeTransactionReceipts,
        });

        return {
          ...baseContract,
          type: "factory",
          criteria: {
            ...factoryCriteria,
            topics,
          },
        } satisfies FactorySource;
      }

      const validatedAddress = Array.isArray(resolvedAddress)
        ? resolvedAddress.map((r) => toLowerCase(r))
        : resolvedAddress
          ? toLowerCase(resolvedAddress)
          : undefined;

      if (validatedAddress !== undefined) {
        for (const address of Array.isArray(validatedAddress)
          ? validatedAddress
          : [validatedAddress]) {
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

      return {
        ...baseContract,
        type: "log",
        criteria: {
          address: validatedAddress,
          topics,
          includeTransactionReceipts: rawContract.includeTransactionReceipts,
        },
      } satisfies LogSource;
    })
    // Remove sources with no registered indexing functions
    .filter((source) => {
      const hasRegisteredIndexingFunctions =
        source.criteria.topics[0]?.length !== 0;
      if (!hasRegisteredIndexingFunctions) {
        logs.push({
          level: "debug",
          msg: `No indexing functions were registered for contract '${source.contractName}'`,
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

      const intervalMaybeNan = blockSourceConfig.interval;
      const interval = Number.isNaN(intervalMaybeNan) ? 0 : intervalMaybeNan;

      if (!Number.isInteger(interval) || interval === 0) {
        throw Error(
          `Validation failed: Invalid interval for block source '${sourceName}'. Got ${interval}, expected a non-zero integer.`,
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
            }', expected one of [${networks
              .map((n) => `'${n.name}'`)
              .join(", ")}].`,
          );
        }

        return {
          type: "block",
          id: `${sourceName}_${blockSourceConfig.network}`,
          sourceName,
          networkName: blockSourceConfig.network,
          chainId: network.chainId,
          startBlock,
          endBlock,
          criteria: {
            interval: interval,
            offset: startBlock % interval,
          },
        } as const;
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

          const intervalMaybeNan =
            overrides.interval ?? blockSourceConfig.interval;
          const interval = Number.isNaN(intervalMaybeNan)
            ? 0
            : intervalMaybeNan;

          if (!Number.isInteger(interval) || interval === 0) {
            throw Error(
              `Validation failed: Invalid interval for block source '${sourceName}'. Got ${interval}, expected a non-zero integer.`,
            );
          }

          return {
            type: "block",
            id: `${sourceName}_${networkName}`,
            sourceName,
            networkName,
            chainId: network.chainId,
            startBlock,
            endBlock,
            criteria: {
              interval: interval,
              offset: startBlock % interval,
            },
          } as const;
        });
    })
    .filter((blockSource) => {
      const hasRegisteredIndexingFunction =
        indexingFunctions[`${blockSource.sourceName}:block`] !== undefined;
      if (!hasRegisteredIndexingFunction) {
        logs.push({
          level: "debug",
          msg: `No indexing functions were registered for block source '${blockSource.sourceName}'`,
        });
      }
      return hasRegisteredIndexingFunction;
    });

  const sources = [...logOrFactorySources, ...blockSources];

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
  } catch (error_) {
    const error = error_ as Error;
    return { status: "error", error } as const;
  }
}

function getDatabaseName(connectionString: string) {
  const parsed = (parse as unknown as typeof parse.parse)(connectionString);
  return `${parsed.host}:${parsed.port}/${parsed.database}`;
}
