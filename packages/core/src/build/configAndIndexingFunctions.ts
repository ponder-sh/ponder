import type { Config } from "@/config/index.js";
import { BuildError } from "@/internal/errors.js";
import type {
  AccountSource,
  BlockSource,
  Chain,
  ContractSource,
  IndexingFunctions,
  RawIndexingFunctions,
  Source,
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
import { getFinalityBlockCount } from "@/utils/finality.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { dedupe } from "@ponder/common";
import { type Hex, type LogTopic, defineChain, extractChain } from "viem";
import * as viemChains from "viem/chains";
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
  chains: Chain[];
  sources: Source[];
  indexingFunctions: IndexingFunctions;
  logs: { level: "warn" | "info" | "debug"; msg: string }[];
}> {
  const logs: { level: "warn" | "info" | "debug"; msg: string }[] = [];

  const chains = Object.entries(config.networks).map(
    ([networkName, network]) => {
      const rpcUrl = network.rpcUrl ?? network.transport;

      // if (isRpcUrlPublic(rpcUrl)) {
      //   logs.push({
      //     level: "warn",
      //     msg: `Network '${networkName}' is using a public RPC URL (${rpcUrl}). Most apps require an RPC URL with a higher rate limit.`,
      //   });
      // }

      if ((network.pollingInterval ?? 1_000) < 100) {
        throw new Error(
          `Invalid 'pollingInterval' for network '${networkName}. Expected 100 milliseconds or greater, got ${network.pollingInterval} milliseconds.`,
        );
      }

      let chain = extractChain({
        // @ts-ignore
        chains: Object.values(viemChains),
        id: network.chainId,
      });

      if (chain === undefined) {
        chain = defineChain({
          id: network.chainId,
          name: networkName,
          nativeCurrency: {
            decimals: 18,
            name: "Ether",
            symbol: "ETH",
          },
          rpcUrls: { default: { http: [] } },
        });
      }

      chain.name = networkName;

      return {
        chain,
        rpcUrl,
        pollingInterval: network.pollingInterval ?? 1_000,
        maxRequestsPerSecond: network.maxRequestsPerSecond ?? 50,
        disableCache: network.disableCache ?? false,
        finalityBlockCount: getFinalityBlockCount({ chain }),
      } satisfies Chain;
    },
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
    if (source.network === undefined) {
      throw new Error(
        `Validation failed: Network for '${source.name}' is undefined. Expected one of [${chains
          .map((c) => `'${c.chain.name}'`)
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

    const chain = chains.find((c) => c.chain.name === source.network);
    if (chain === undefined) {
      throw new Error(
        `Validation failed: Invalid network for '${
          source.name
        }'. Got '${source.network}', expected one of [${chains
          .map((c) => `'${c.chain.name}'`)
          .join(", ")}].`,
      );
    }
  }

  const contractSources: ContractSource[] = flattenSources(
    config.contracts ?? {},
  )
    .flatMap((source): ContractSource[] => {
      const chain = chains.find((c) => c.chain.name === source.name)!;

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

        // TODO(kyle) should we throw an error when an event selector has
        // a filter but is not registered?

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
        chain,
      } as const;

      const resolvedAddress = source?.address;

      if (
        typeof resolvedAddress === "object" &&
        !Array.isArray(resolvedAddress)
      ) {
        // Note that this can throw.
        const logFactory = buildLogFactory({
          chainId: chain.chain.id,
          ...resolvedAddress,
        });

        const logSources = topicsArray.map(
          (topics) =>
            ({
              ...contractMetadata,
              filter: {
                type: "log",
                chainId: chain.chain.id,
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
                chainId: chain.chain.id,
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
              chainId: chain.chain.id,
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
              chainId: chain.chain.id,
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

  const accountSources: AccountSource[] = flattenSources(config.accounts ?? {})
    .flatMap((source): AccountSource[] => {
      const chain = chains.find((c) => c.chain.name === source.name)!;

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
          chainId: chain.chain.id,
          ...resolvedAddress,
        });

        return [
          {
            type: "account",
            name: source.name,
            chain,
            filter: {
              type: "transaction",
              chainId: chain.chain.id,
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
            chain,
            filter: {
              type: "transaction",
              chainId: chain.chain.id,
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
            chain,
            filter: {
              type: "transfer",
              chainId: chain.chain.id,
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
            chain,
            filter: {
              type: "transfer",
              chainId: chain.chain.id,
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
          chain,
          filter: {
            type: "transaction",
            chainId: chain.chain.id,
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
          chain,
          filter: {
            type: "transaction",
            chainId: chain.chain.id,
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
          chain,
          filter: {
            type: "transfer",
            chainId: chain.chain.id,
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
          chain,
          filter: {
            type: "transfer",
            chainId: chain.chain.id,
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
      const chain = chains.find((c) => c.chain.name === source.name)!;

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
        chain,
        filter: {
          type: "block",
          chainId: chain.chain.id,
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

  // Filter out any chains that don't have any sources registered.
  const chainsWithSources = chains.filter((chain) => {
    const hasSources = sources.some(
      (source) => source.chain.chain.id === chain.chain.id,
    );
    if (!hasSources) {
      logs.push({
        level: "warn",
        msg: `No sources registered for network '${chain.chain.name}'`,
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
    chains: chainsWithSources,
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
      chains: result.chains,
      indexingFunctions: result.indexingFunctions,
      logs: result.logs,
    } as const;
  } catch (_error) {
    const buildError = new BuildError((_error as Error).message);
    buildError.stack = undefined;
    return { status: "error", error: buildError } as const;
  }
}
