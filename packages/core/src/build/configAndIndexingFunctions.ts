import { BuildError } from "@/common/errors.js";
import type { Config } from "@/config/config.js";
import {
  type Network,
  getFinalityBlockCount,
  getRpcUrlsForClient,
  isRpcUrlPublic,
} from "@/config/networks.js";
import { buildAbiEvents, buildAbiFunctions, buildTopics } from "@/sync/abi.js";
import {
  type AccountSource,
  type BlockSource,
  type ContractSource,
  type Source,
  defaultBlockFilterInclude,
  defaultLogFilterInclude,
  defaultTraceFilterInclude,
  defaultTransactionFilterInclude,
  defaultTransactionReceiptInclude,
  defaultTransferFilterInclude,
} from "@/sync/source.js";
import { chains } from "@/utils/chains.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { Address, Hex, LogTopic } from "viem";
import { buildLogFactory } from "./factory.js";

export type RawIndexingFunctions = {
  name: string;
  fn: (...args: any) => any;
}[];

export type IndexingFunctions = {
  [eventName: string]: (...args: any) => any;
};

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

  const contractSources: ContractSource[] = flattenSources(
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

      let topicsArray: {
        topic0: LogTopic;
        topic1: LogTopic;
        topic2: LogTopic;
        topic3: LogTopic;
      }[] = [
        {
          topic0: registeredEventSelectors,
          topic1: null,
          topic2: null,
          topic3: null,
        },
      ];

      if (source.filter !== undefined) {
        source.filter = Array.isArray(source.filter)
          ? source.filter
          : [source.filter];

        for (const filter of source.filter) {
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

        // TODO: Explicit validation of indexed argument value format (array or object).
        // The first element of the array return from `buildTopics` being defined
        // is an invariant of the current filter design.
        // Note: This can throw.

        const filteredTopicsArray = buildTopics(
          source.abi,
          source.filter,
        ).reduce(
          (acc, cur) => {
            if (acc.includes(cur) === false) {
              acc.push(cur);
            }

            return acc;
          },
          [] as {
            topic0: Hex;
            topic1: Hex | Hex[] | null;
            topic2: Hex | Hex[] | null;
            topic3: Hex | Hex[] | null;
          }[],
        );

        const filteredEventSelectors = filteredTopicsArray.reduce(
          (acc, cur) => {
            const eventSelector = cur.topic0;

            if (
              eventSelector !== null &&
              acc.includes(eventSelector) === false
            ) {
              acc.push(eventSelector);
            }

            return acc;
          },
          [] as Hex[],
        );

        // Merge filtered topics and registered event selectors
        const excludedRegisteredEventSelectors =
          registeredEventSelectors.filter(
            (s) => filteredEventSelectors.includes(s) === false,
          );

        topicsArray =
          excludedRegisteredEventSelectors.length > 0
            ? [
                {
                  topic0: excludedRegisteredEventSelectors,
                  topic1: null,
                  topic2: null,
                  topic3: null,
                },
                ...filteredTopicsArray,
              ]
            : filteredTopicsArray;
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

      if (
        typeof resolvedAddress === "object" &&
        !Array.isArray(resolvedAddress)
      ) {
        // Note that this can throw.
        const logFactory = buildLogFactory({
          chainId: network.chainId,
          ...resolvedAddress,
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
        ? (resolvedAddress.map((r) => toLowerCase(r)) as Address[])
        : resolvedAddress !== undefined
          ? (toLowerCase(resolvedAddress) as Address)
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

  const accountSources: AccountSource[] = flattenSources(config.accounts ?? {})
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
              include: defaultTransactionFilterInclude,
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
              include: defaultTransactionFilterInclude,
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
            networkName: source.network,
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
            include: defaultTransactionFilterInclude,
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
            include: defaultTransactionFilterInclude,
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
          networkName: source.network,
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

  const blockSources: BlockSource[] = flattenSources(config.blocks ?? {})
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
          include: defaultBlockFilterInclude,
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
