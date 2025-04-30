import type { Config } from "@/config/index.js";
import type { Common } from "@/internal/common.js";
import { BuildError } from "@/internal/errors.js";
import type {
  BlockFilter,
  Chain,
  IndexingBuild,
  IndexingFunctions,
  LogFilter,
  SyncBlock,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import { createRpc } from "@/rpc/index.js";
import {
  defaultBlockFilterInclude,
  defaultLogFilterInclude,
  defaultTraceFilterInclude,
  defaultTransactionFilterInclude,
  defaultTransactionReceiptInclude,
  defaultTransferFilterInclude,
} from "@/sync/filter.js";
import { buildTopics, toSafeName } from "@/utils/abi.js";
import { chains as viemChains } from "@/utils/chains.js";
import { dedupe } from "@/utils/dedupe.js";
import { getFinalityBlockCount } from "@/utils/finality.js";
import { toLowerCase } from "@/utils/lowercase.js";
import {
  type AbiEvent,
  type AbiFunction,
  BlockNotFoundError,
  type Hex,
  type LogTopic,
  hexToNumber,
  toEventSelector,
  toFunctionSelector,
} from "viem";
import { buildLogFactory } from "./factory.js";

const flattenSources = <
  T extends Config["contracts"] | Config["accounts"] | Config["blocks"],
>(
  config: T,
): (Omit<T[string], "chain"> & { name: string; chain: string })[] => {
  return Object.entries(config).flatMap(
    ([name, source]: [string, T[string]]) => {
      if (typeof source.chain === "string") {
        return {
          name,
          ...source,
        };
      } else {
        return Object.entries(source.chain).map(([chain, sourceOverride]) => {
          const { chain: _chain, ...base } = source;

          return {
            name,
            chain,
            ...base,
            ...sourceOverride,
          };
        });
      }
    },
  );
};

export async function buildConfigAndIndexingFunctions(
  common: Common,
  {
    config,
    indexingFunctions,
  }: {
    config: Config;
    indexingFunctions: IndexingFunctions;
  },
): Promise<{
  indexingBuild: IndexingBuild[];
  logs: { level: "warn" | "info" | "debug"; msg: string }[];
}> {
  const logs: { level: "warn" | "info" | "debug"; msg: string }[] = [];

  const perChainLatestBlockNumber = new Map<string, Promise<number>>();

  const resolveBlockNumber = async (
    blockNumberOrTag: number | "latest" | undefined,
    chain: Chain,
  ) => {
    if (blockNumberOrTag === undefined) {
      return undefined;
    }

    if (Number.isNaN(blockNumberOrTag)) {
      return undefined;
    }
    if (blockNumberOrTag === "latest") {
      if (perChainLatestBlockNumber.has(chain.chain.name)) {
        return perChainLatestBlockNumber.get(chain.chain.name)!;
      } else {
        const blockPromise = chain.rpc
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
              `Unable to fetch "latest" block for chain '${chain.chain.name}':\n${e.message}`,
            );
          });
        perChainLatestBlockNumber.set(chain.chain.name, blockPromise);
        return blockPromise;
      }
    }
    return blockNumberOrTag;
  };

  const chains: Chain[] = await Promise.all(
    Object.entries(config.chains).map(async ([chainName, chain]) => {
      const matchedChain = Object.values(viemChains).find((c) =>
        "id" in c ? c.id === chain.id : false,
      );

      if (matchedChain === undefined) {
        throw new Error(
          `Chain with id ${chain.id} not found in viem. Please update viem to the latest version.`,
        );
      }
      matchedChain.name = chainName;

      // Note: This can throw.
      // const rpcUrls = await getRpcUrlsForClient({ transport, chain });
      // rpcUrls.forEach((rpcUrl) => {
      //   if (isRpcUrlPublic(rpcUrl)) {
      //     logs.push({
      //       level: "warn",
      //       msg: `Network '${networkName}' is using a public RPC URL (${rpcUrl}). Most apps require an RPC URL with a higher rate limit.`,
      //     });
      //   }
      // });

      if (chain.pollingInterval !== undefined && chain.pollingInterval! < 100) {
        throw new Error(
          `Invalid 'pollingInterval' for chain '${chainName}. Expected 100 milliseconds or greater, got ${chain.pollingInterval} milliseconds.`,
        );
      }

      return {
        chain: matchedChain,
        rpcUrl: chain.rpcUrl,
        maxRequestsPerSecond: chain.maxRequestsPerSecond ?? 50,
        pollingInterval: chain.pollingInterval ?? 1_000,
        finalityBlockCount: getFinalityBlockCount({ chain: matchedChain }),
        disableCache: chain.disableCache ?? false,
        rpc: createRpc(common, {
          chain: matchedChain,
          rpcUrl: chain.rpcUrl,
          maxRequestsPerSecond: chain.maxRequestsPerSecond ?? 50,
        }),
      } satisfies Chain;
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

  // Validate indexing functions

  if (indexingFunctions.length === 0) {
    throw new Error(
      "Validation failed: Found 0 registered indexing functions.",
    );
  }

  for (const { name: eventName } of indexingFunctions) {
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
  }

  const perChainIndexingBuild = new Map<
    Chain,
    IndexingBuild["eventCallbacks"]
  >();
  for (const chain of chains) {
    perChainIndexingBuild.set(chain, []);
  }

  // common validation for all sources
  for (const source of [
    ...flattenSources(config.contracts ?? {}),
    ...flattenSources(config.accounts ?? {}),
    ...flattenSources(config.blocks ?? {}),
  ]) {
    if (source.chain === null || source.chain === undefined) {
      throw new Error(
        `Validation failed: Chain for '${source.name}' is null or undefined. Expected one of [${chains
          .map((c) => `'${c.chain.name}'`)
          .join(", ")}].`,
      );
    }

    const chain = chains.find((c) => c.chain.name === source.chain);
    if (!chain) {
      throw new Error(
        `Validation failed: Invalid chain for '${
          source.name
        }'. Got '${source.chain}', expected one of [${chains
          .map((c) => `'${c.chain.name}'`)
          .join(", ")}].`,
      );
    }

    const startBlock = await resolveBlockNumber(source.startBlock, chain);
    const endBlock = await resolveBlockNumber(source.endBlock, chain);

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

  for (const source of flattenSources(config.contracts ?? {})) {
    const chain = chains.find((c) => c.chain.name === source.chain)!;
    const filters: (LogFilter | TraceFilter)[] = [];

    // Get indexing function that were registered for this contract
    const registeredLogEvents: string[] = [];
    const registeredCallTraceEvents: string[] = [];
    for (const { name } of indexingFunctions) {
      // log event
      if (name.includes(":")) {
        const [logContractName, logEventName] = name.split(":") as [
          string,
          string,
        ];
        if (logContractName === source.name && logEventName !== "setup") {
          registeredLogEvents.push(logEventName);
        }
      }

      //  trace event
      if (name.includes(".")) {
        const [functionContractName, functionName] = name.split(".") as [
          string,
          string,
        ];
        if (functionContractName === source.name) {
          registeredCallTraceEvents.push(functionName);
        }
      }
    }

    // Note: This can probably throw for invalid ABIs. Consider adding explicit ABI validation before this line.

    const registeredEventSelectors: Hex[] = [];
    // Validate that the registered log events exist in the abi
    for (const logEvent of registeredLogEvents) {
      const abiEvent = source.abi.find(
        (item): item is AbiEvent =>
          item.type === "event" &&
          toSafeName({ abi: source.abi, item }) === logEvent,
      );

      if (abiEvent === undefined) {
        throw new Error(
          `Validation failed: Event name for event '${logEvent}' not found in the contract ABI. Got '${logEvent}', expected one of [${source.abi
            .filter((item): item is AbiEvent => item.type === "event")
            .map((item) => `'${toSafeName({ abi: source.abi, item })}'`)
            .join(", ")}].`,
        );
      }

      registeredEventSelectors.push(toEventSelector(abiEvent));
    }

    const registeredFunctionSelectors: Hex[] = [];
    for (const _function of registeredCallTraceEvents) {
      const abiFunction = source.abi.find(
        (item): item is AbiFunction =>
          item.type === "function" &&
          toSafeName({ abi: source.abi, item }) === _function,
      );

      if (abiFunction === undefined) {
        throw new Error(
          `Validation failed: Function name for function '${_function}' not found in the contract ABI. Got '${_function}', expected one of [${source.abi
            .filter((item): item is AbiFunction => item.type === "function")
            .map((item) => `'${toSafeName({ abi: source.abi, item })}'`)
            .join(", ")}].`,
        );
      }

      registeredFunctionSelectors.push(toFunctionSelector(abiFunction));
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
        const abiEvent = source.abi.find(
          (item): item is AbiEvent =>
            item.type === "event" &&
            toSafeName({ abi: source.abi, item }) === filter.event,
        );
        if (abiEvent === undefined) {
          throw new Error(
            `Validation failed: Invalid filter for contract '${
              source.name
            }'. Got event name '${filter.event}', expected one of [${source.abi
              .filter((item): item is AbiEvent => item.type === "event")
              .map((item) => `'${toSafeName({ abi: source.abi, item })}'`)
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
      const excludedRegisteredEventSelectors = registeredEventSelectors.filter(
        (s) => filteredEventSelectors.includes(s) === false,
      );

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

    const fromBlock = await resolveBlockNumber(source.startBlock, chain);
    const toBlock = await resolveBlockNumber(source.endBlock, chain);

    const resolvedAddress = source?.address;

    if (
      typeof resolvedAddress === "object" &&
      !Array.isArray(resolvedAddress)
    ) {
      // Note that this can throw.
      const logFactory = buildLogFactory({
        chainId: chain.chain.id,
        ...resolvedAddress,
        fromBlock,
        toBlock,
      });

      const logFilters = topicsArray.map(
        (topics) =>
          ({
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
          }) satisfies LogFilter,
      );

      filters.push(...logFilters);

      if (source.includeCallTraces) {
        filters.push({
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
        });
      }
    } else {
      if (resolvedAddress !== undefined) {
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

      const logFilters = topicsArray.map(
        (topics) =>
          ({
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
          }) satisfies LogFilter,
      );

      filters.push(...logFilters);

      if (source.includeCallTraces) {
        filters.push({
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
        });
      }
    }

    for (const filter of filters) {
      if (filter.type === "log") {
        if (registeredLogEvents.length > 0) {
          for (const eventName of registeredLogEvents) {
            const indexingFunction = indexingFunctions.find(
              (f) => `${source.name}:${eventName}` === f.name,
            )!;

            perChainIndexingBuild.get(chain)!.push({
              type: "contract",
              filter,
              callback: indexingFunction.fn,
              name: indexingFunction.name,
              abiItem: source.abi.find(
                (item) =>
                  item.type === "event" &&
                  toSafeName({ abi: source.abi, item }) === eventName,
              )! as AbiEvent,
              metadata: { safeName: eventName, abi: source.abi },
            });
          }
        } else {
          logs.push({
            level: "debug",
            msg: `No indexing functions were registered for '${
              source.name
            }' logs`,
          });
        }
      } else {
        if (registeredCallTraceEvents.length > 0) {
          for (const functionName of registeredCallTraceEvents) {
            const indexingFunction = indexingFunctions.find(
              (f) => `${source.name}.${functionName}` === f.name,
            )!;

            perChainIndexingBuild.get(chain)!.push({
              type: "contract",
              filter,
              callback: indexingFunction.fn,
              name: indexingFunction.name,
              abiItem: source.abi.find(
                (item) =>
                  item.type === "function" &&
                  toSafeName({ abi: source.abi, item }) === functionName,
              )! as AbiFunction,
              metadata: { safeName: functionName, abi: source.abi },
            });
          }
        } else {
          logs.push({
            level: "debug",
            msg: `No indexing functions were registered for '${
              source.name
            }' traces`,
          });
        }
      }
    }
  }

  for (const source of flattenSources(config.accounts ?? {})) {
    const chain = chains.find((c) => c.chain.name === source.chain)!;
    const filters: (TransferFilter | TransactionFilter)[] = [];

    const fromBlock = await resolveBlockNumber(source.startBlock, chain);
    const toBlock = await resolveBlockNumber(source.endBlock, chain);

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
        fromBlock,
        toBlock,
      });

      filters.push({
        type: "transaction",
        chainId: chain.chain.id,
        fromAddress: undefined,
        toAddress: logFactory,
        includeReverted: false,
        fromBlock,
        toBlock,
        include: defaultTransactionFilterInclude,
      });

      filters.push({
        type: "transaction",
        chainId: chain.chain.id,
        fromAddress: logFactory,
        toAddress: undefined,
        includeReverted: false,
        fromBlock,
        toBlock,
        include: defaultTransactionFilterInclude,
      });

      filters.push({
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
      });

      filters.push({
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
      });
    } else {
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

      filters.push({
        type: "transaction",
        chainId: chain.chain.id,
        fromAddress: undefined,
        toAddress: validatedAddress,
        includeReverted: false,
        fromBlock,
        toBlock,
        include: defaultTransactionFilterInclude,
      });

      filters.push({
        type: "transaction",
        chainId: chain.chain.id,
        fromAddress: validatedAddress,
        toAddress: undefined,
        includeReverted: false,
        fromBlock,
        toBlock,
        include: defaultTransactionFilterInclude,
      });

      filters.push({
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
      });

      filters.push({
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
      });
    }

    for (const filter of filters) {
      const eventName =
        filter.type === "transaction"
          ? filter.fromAddress === undefined
            ? `${source.name}:transaction:to`
            : `${source.name}:transaction:from`
          : filter.fromAddress === undefined
            ? `${source.name}:transfer:to`
            : `${source.name}:transfer:from`;

      const indexingFunction = indexingFunctions.find(
        (f) => f.name === eventName,
      );
      if (indexingFunction) {
        perChainIndexingBuild.get(chain)!.push({
          type: "account",
          direction: filter.fromAddress === undefined ? "to" : "from",
          filter,
          callback: indexingFunction.fn,
          name: indexingFunction.name,
        });
      } else {
        logs.push({
          level: "debug",
          msg: `No indexing functions were registered for '${eventName}'`,
        });
      }
    }
  }

  for (const source of flattenSources(config.blocks ?? {})) {
    const chain = chains.find((c) => c.chain.name === source.chain)!;

    const intervalMaybeNan = source.interval ?? 1;
    const interval = Number.isNaN(intervalMaybeNan) ? 0 : intervalMaybeNan;

    if (!Number.isInteger(interval) || interval === 0) {
      throw new Error(
        `Validation failed: Invalid interval for block source '${source.name}'. Got ${interval}, expected a non-zero integer.`,
      );
    }

    const fromBlock = await resolveBlockNumber(source.startBlock, chain);
    const toBlock = await resolveBlockNumber(source.endBlock, chain);

    const blockFilter = {
      type: "block",
      chainId: chain.chain.id,
      interval: interval,
      offset: (fromBlock ?? 0) % interval,
      fromBlock,
      toBlock,
      include: defaultBlockFilterInclude,
    } satisfies BlockFilter;

    const indexingFunction = indexingFunctions.find(
      (f) => f.name === `${source.name}:block`,
    );
    if (indexingFunction) {
      perChainIndexingBuild.get(chain)!.push({
        type: "block",
        filter: blockFilter,
        callback: indexingFunction.fn,
        name: indexingFunction.name,
      });
    } else {
      logs.push({
        level: "debug",
        msg: `No indexing functions were registered for '${source.name}' blocks`,
      });
    }
  }

  // Filter out any chains that don't have any event callbacks registered.
  for (const [chain, eventCallbacks] of perChainIndexingBuild) {
    if (eventCallbacks.length === 0) {
      logs.push({
        level: "warn",
        msg: `No sources registered for chain '${chain.chain.name}'`,
      });
      perChainIndexingBuild.delete(chain);
    }
  }

  const indexingBuild: IndexingBuild[] = [];
  for (const [chain, eventCallbacks] of perChainIndexingBuild) {
    indexingBuild.push({ chain, eventCallbacks });
  }

  return { indexingBuild, logs };
}

export async function safeBuildConfigAndIndexingFunctions(
  common: Common,
  {
    config,
    indexingFunctions,
  }: {
    config: Config;
    indexingFunctions: IndexingFunctions;
  },
) {
  try {
    const result = await buildConfigAndIndexingFunctions(common, {
      config,
      indexingFunctions,
    });

    return {
      status: "success",
      indexingBuild: result.indexingBuild,
      logs: result.logs,
    } as const;
  } catch (_error) {
    const buildError = new BuildError((_error as Error).message);
    buildError.stack = undefined;
    return { status: "error", error: buildError } as const;
  }
}
