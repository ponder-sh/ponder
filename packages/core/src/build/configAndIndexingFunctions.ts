import type { Config } from "@/config/index.js";
import {
  getFinalityBlockCount,
  getRpcUrlsForClient,
  isRpcUrlPublic,
} from "@/config/networks.js";
import { BuildError } from "@/internal/errors.js";
import type {
  AccountSource,
  BlockSource,
  ContractSource,
  IndexingFunctions,
  Network,
  RawIndexingFunctions,
  Source,
  SyncBlock,
} from "@/internal/types.js";
import { buildAbiEvents, buildAbiFunctions, buildTopics } from "@/sync/abi.js";
import {
  defaultBlockFilterInclude,
  defaultLogFilterInclude,
  defaultTraceFilterInclude,
  defaultTransactionFilterInclude,
  defaultTransactionReceiptInclude,
  defaultTransferFilterInclude,
} from "@/sync/filter.js";
import { chains } from "@/utils/chains.js";
import { dedupe } from "@/utils/dedupe.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { BlockNotFoundError, type Hex, type LogTopic, hexToNumber } from "viem";
import { buildLogFactory } from "./factory.js";

const flattenSources = <
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
}: {
  config: Config;
  rawIndexingFunctions: RawIndexingFunctions;
}): Promise<{
  networks: Network[];
  sources: Source[];
  indexingFunctions: IndexingFunctions;
  logs: { level: "warn" | "info" | "debug"; msg: string }[];
}> {
  const logs: { level: "warn" | "info" | "debug"; msg: string }[] = [];

  const perNetworkLatestBlockNumber = new Map<string, Promise<number>>();

  const resolveBlockNumber = async (
    blockNumberOrTag: number | "latest" | undefined,
    network: Network,
  ) => {
    if (blockNumberOrTag === undefined) {
      return undefined;
    }

    if (Number.isNaN(blockNumberOrTag)) {
      return undefined;
    }
    if (blockNumberOrTag === "latest") {
      if (perNetworkLatestBlockNumber.has(network.name)) {
        return perNetworkLatestBlockNumber.get(network.name)!;
      } else {
        const blockPromise = network.transport
          .request({
            method: "eth_getBlockByNumber",
            params: ["latest", false],
          })
          .then((block) => {
            if (!block)
              throw new BlockNotFoundError({ blockNumber: "latest" as any });
            return hexToNumber((block as SyncBlock).number);
          })
          .catch((e) => {
            throw new Error(
              `Unable to fetch "latest" block for network '${network.name}':\n${e.message}`,
            );
          });
        perNetworkLatestBlockNumber.set(network.name, blockPromise);
        return blockPromise;
      }
    }
    return blockNumberOrTag;
  };

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
        `Validation failed: Invalid event '${eventName}', expected format '{sourceName}:{eventName}' or '{sourceName}.{functionName}'.`,
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
          `Validation failed: Invalid event '${eventName}', expected format '{sourceName}:{eventName}' or '{sourceName}.{functionName}'.`,
        );
      }
    } else {
      throw new Error(
        `Validation failed: Invalid event '${eventName}', expected format '{sourceName}:{eventName}' or '{sourceName}.{functionName}'.`,
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
      throw new Error(
        `Validation failed: Invalid source name '${sourceName}'. Got '${sourceName}', expected one of [${Array.from(
          sourceNames,
        )
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
    ...flattenSources(config.contracts ?? {}),
    ...flattenSources(config.accounts ?? {}),
    ...flattenSources(config.blocks ?? {}),
  ]) {
    if (source.network === null || source.network === undefined) {
      throw new Error(
        `Validation failed: Network for '${source.name}' is null or undefined. Expected one of [${networks
          .map((n) => `'${n.name}'`)
          .join(", ")}].`,
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

    const startBlock = await resolveBlockNumber(source.startBlock, network);
    const endBlock = await resolveBlockNumber(source.endBlock, network);

    if (
      startBlock !== undefined &&
      endBlock !== undefined &&
      endBlock < startBlock
    ) {
      throw new Error(
        `Validation failed: Start block for '${source.name}' is after end block (${startBlock} > ${endBlock}).`,
      );
    }
  }

  const contractSources: ContractSource[] = (
    await Promise.all(
      flattenSources(config.contracts ?? {}).map(
        async (source): Promise<ContractSource[]> => {
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
              const [functionContractName, functionName] = eventName.split(
                ".",
              ) as [string, string];
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

          const topicsArray: {
            topic0: LogTopic;
            topic1: LogTopic;
            topic2: LogTopic;
            topic3: LogTopic;
          }[] = [];

          if (source.filter !== undefined) {
            const eventFilters = Array.isArray(source.filter)
              ? source.filter
              : [source.filter];

            for (const filter of eventFilters) {
              const abiEvent = abiEvents.bySafeName[filter.event];
              if (!abiEvent) {
                throw new Error(
                  `Validation failed: Invalid filter for contract '${
                    source.name
                  }'. Got event name '${filter.event}', expected one of [${Object.keys(
                    abiEvents.bySafeName,
                  )
                    .map((n) => `'${n}'`)
                    .join(", ")}].`,
                );
              }
            }

            topicsArray.push(...buildTopics(source.abi, eventFilters));

            // event selectors that have a filter
            const filteredEventSelectors: Hex[] = topicsArray.map(
              (t) => t.topic0 as Hex,
            );
            // event selectors that are registered but don't have a filter
            const excludedRegisteredEventSelectors =
              registeredEventSelectors.filter(
                (s) => filteredEventSelectors.includes(s) === false,
              );

            for (const selector of filteredEventSelectors) {
              if (registeredEventSelectors.includes(selector) === false) {
                throw new Error(
                  `Validation failed: Event selector '${abiEvents.bySelector[selector]?.safeName}' is used in a filter but does not have a corresponding indexing function.`,
                );
              }
            }

            if (excludedRegisteredEventSelectors.length > 0) {
              topicsArray.push({
                topic0: excludedRegisteredEventSelectors,
                topic1: null,
                topic2: null,
                topic3: null,
              });
            }
          } else {
            topicsArray.push({
              topic0: registeredEventSelectors,
              topic1: null,
              topic2: null,
              topic3: null,
            });
          }

          const fromBlock = await resolveBlockNumber(
            source.startBlock,
            network,
          );
          const toBlock = await resolveBlockNumber(source.endBlock, network);

          const contractMetadata = {
            type: "contract",
            abi: source.abi,
            abiEvents,
            abiFunctions,
            name: source.name,
            network,
          } as const;

          const resolvedAddress = source?.address;

          if (
            typeof resolvedAddress === "object" &&
            !Array.isArray(resolvedAddress)
          ) {
            // Note that this can throw.
            const logFactory = buildLogFactory({
              chainId: network.chainId,
              ...resolvedAddress,
              fromBlock,
              toBlock,
            });

            const logSources = topicsArray.map(
              (topics) =>
                ({
                  ...contractMetadata,
                  filter: {
                    type: "log",
                    chainId: network.chainId,
                    address: logFactory,
                    topic0: topics.topic0,
                    topic1: topics.topic1,
                    topic2: topics.topic2,
                    topic3: topics.topic3,
                    fromBlock,
                    toBlock,
                    include: defaultLogFilterInclude.concat(
                      source.includeTransactionReceipts
                        ? defaultTransactionReceiptInclude
                        : [],
                    ),
                  },
                }) satisfies ContractSource,
            );

            if (source.includeCallTraces) {
              return [
                ...logSources,
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
                    fromBlock,
                    toBlock,
                    include: defaultTraceFilterInclude.concat(
                      source.includeTransactionReceipts
                        ? defaultTransactionReceiptInclude
                        : [],
                    ),
                  },
                } satisfies ContractSource,
              ];
            }

            return logSources;
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
            ? dedupe(resolvedAddress).map((r) => toLowerCase(r))
            : resolvedAddress !== undefined
              ? toLowerCase(resolvedAddress)
              : undefined;

          const logSources = topicsArray.map(
            (topics) =>
              ({
                ...contractMetadata,
                filter: {
                  type: "log",
                  chainId: network.chainId,
                  address: validatedAddress,
                  topic0: topics.topic0,
                  topic1: topics.topic1,
                  topic2: topics.topic2,
                  topic3: topics.topic3,
                  fromBlock,
                  toBlock,
                  include: defaultLogFilterInclude.concat(
                    source.includeTransactionReceipts
                      ? defaultTransactionReceiptInclude
                      : [],
                  ),
                },
              }) satisfies ContractSource,
          );

          if (source.includeCallTraces) {
            return [
              ...logSources,
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
                  fromBlock,
                  toBlock,
                  include: defaultTraceFilterInclude.concat(
                    source.includeTransactionReceipts
                      ? defaultTransactionReceiptInclude
                      : [],
                  ),
                },
              } satisfies ContractSource,
            ];
          } else return logSources;
        },
      ),
    )
  )
    .flat() // Remove sources with no registered indexing functions
    .filter((source) => {
      const hasNoRegisteredIndexingFunctions =
        source.filter.type === "trace"
          ? Array.isArray(source.filter.functionSelector) &&
            source.filter.functionSelector.length === 0
          : Array.isArray(source.filter.topic0) &&
            source.filter.topic0?.length === 0;
      if (hasNoRegisteredIndexingFunctions) {
        logs.push({
          level: "debug",
          msg: `No indexing functions were registered for '${
            source.name
          }' ${source.filter.type === "trace" ? "traces" : "logs"}`,
        });
      }
      return hasNoRegisteredIndexingFunctions === false;
    });

  const accountSources: AccountSource[] = (
    await Promise.all(
      flattenSources(config.accounts ?? {}).map(
        async (source): Promise<AccountSource[]> => {
          const network = networks.find((n) => n.name === source.network)!;

          const fromBlock = await resolveBlockNumber(
            source.startBlock,
            network,
          );
          const toBlock = await resolveBlockNumber(source.endBlock, network);

          const resolvedAddress = source?.address;

          if (resolvedAddress === undefined) {
            throw new Error(
              `Validation failed: Account '${source.name}' must specify an 'address'.`,
            );
          }

          if (
            typeof resolvedAddress === "object" &&
            !Array.isArray(resolvedAddress)
          ) {
            // Note that this can throw.
            const logFactory = buildLogFactory({
              chainId: network.chainId,
              ...resolvedAddress,
              fromBlock,
              toBlock,
            });

            return [
              {
                type: "account",
                name: source.name,
                network,
                filter: {
                  type: "transaction",
                  chainId: network.chainId,
                  fromAddress: undefined,
                  toAddress: logFactory,
                  includeReverted: false,
                  fromBlock,
                  toBlock,
                  include: defaultTransactionFilterInclude,
                },
              } satisfies AccountSource,
              {
                type: "account",
                name: source.name,
                network,
                filter: {
                  type: "transaction",
                  chainId: network.chainId,
                  fromAddress: logFactory,
                  toAddress: undefined,
                  includeReverted: false,
                  fromBlock,
                  toBlock,
                  include: defaultTransactionFilterInclude,
                },
              } satisfies AccountSource,
              {
                type: "account",
                name: source.name,
                network,
                filter: {
                  type: "transfer",
                  chainId: network.chainId,
                  fromAddress: undefined,
                  toAddress: logFactory,
                  includeReverted: false,
                  fromBlock,
                  toBlock,
                  include: defaultTransferFilterInclude.concat(
                    source.includeTransactionReceipts
                      ? defaultTransactionReceiptInclude
                      : [],
                  ),
                },
              } satisfies AccountSource,
              {
                type: "account",
                name: source.name,
                network,
                filter: {
                  type: "transfer",
                  chainId: network.chainId,
                  fromAddress: logFactory,
                  toAddress: undefined,
                  includeReverted: false,
                  fromBlock,
                  toBlock,
                  include: defaultTransferFilterInclude.concat(
                    source.includeTransactionReceipts
                      ? defaultTransactionReceiptInclude
                      : [],
                  ),
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
            ? dedupe(resolvedAddress).map((r) => toLowerCase(r))
            : resolvedAddress !== undefined
              ? toLowerCase(resolvedAddress)
              : undefined;

          return [
            {
              type: "account",
              name: source.name,
              network,
              filter: {
                type: "transaction",
                chainId: network.chainId,
                fromAddress: undefined,
                toAddress: validatedAddress,
                includeReverted: false,
                fromBlock,
                toBlock,
                include: defaultTransactionFilterInclude,
              },
            } satisfies AccountSource,
            {
              type: "account",
              name: source.name,
              network,
              filter: {
                type: "transaction",
                chainId: network.chainId,
                fromAddress: validatedAddress,
                toAddress: undefined,
                includeReverted: false,
                fromBlock,
                toBlock,
                include: defaultTransactionFilterInclude,
              },
            } satisfies AccountSource,
            {
              type: "account",
              name: source.name,
              network,
              filter: {
                type: "transfer",
                chainId: network.chainId,
                fromAddress: undefined,
                toAddress: validatedAddress,
                includeReverted: false,
                fromBlock,
                toBlock,
                include: defaultTransferFilterInclude.concat(
                  source.includeTransactionReceipts
                    ? defaultTransactionReceiptInclude
                    : [],
                ),
              },
            } satisfies AccountSource,
            {
              type: "account",
              name: source.name,
              network,
              filter: {
                type: "transfer",
                chainId: network.chainId,
                fromAddress: validatedAddress,
                toAddress: undefined,
                includeReverted: false,
                fromBlock,
                toBlock,
                include: defaultTransferFilterInclude.concat(
                  source.includeTransactionReceipts
                    ? defaultTransactionReceiptInclude
                    : [],
                ),
              },
            } satisfies AccountSource,
          ];
        },
      ),
    )
  )
    .flat()
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

  const blockSources: BlockSource[] = (
    await Promise.all(
      flattenSources(config.blocks ?? {}).map(async (source) => {
        const network = networks.find((n) => n.name === source.network)!;

        const intervalMaybeNan = source.interval ?? 1;
        const interval = Number.isNaN(intervalMaybeNan) ? 0 : intervalMaybeNan;

        if (!Number.isInteger(interval) || interval === 0) {
          throw new Error(
            `Validation failed: Invalid interval for block source '${source.name}'. Got ${interval}, expected a non-zero integer.`,
          );
        }

        const fromBlock = await resolveBlockNumber(source.startBlock, network);
        const toBlock = await resolveBlockNumber(source.endBlock, network);

        return {
          type: "block",
          name: source.name,
          network,
          filter: {
            type: "block",
            chainId: network.chainId,
            interval: interval,
            offset: (fromBlock ?? 0) % interval,
            fromBlock,
            toBlock,
            include: defaultBlockFilterInclude,
          },
        } satisfies BlockSource;
      }),
    )
  )
    .flat()
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
      (source) => source.network.name === network.name,
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
    networks: networksWithSources,
    sources,
    indexingFunctions,
    logs,
  };
}

export async function safeBuildConfigAndIndexingFunctions({
  config,
  rawIndexingFunctions,
}: {
  config: Config;
  rawIndexingFunctions: RawIndexingFunctions;
}) {
  try {
    const result = await buildConfigAndIndexingFunctions({
      config,
      rawIndexingFunctions,
    });

    return {
      status: "success",
      sources: result.sources,
      networks: result.networks,
      indexingFunctions: result.indexingFunctions,
      logs: result.logs,
    } as const;
  } catch (_error) {
    const buildError = new BuildError((_error as Error).message);
    buildError.stack = undefined;
    return { status: "error", error: buildError } as const;
  }
}
