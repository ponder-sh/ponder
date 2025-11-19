import type { Factory } from "@/config/address.js";
import type { Config } from "@/config/index.js";
import type { Common } from "@/internal/common.js";
import { BuildError } from "@/internal/errors.js";
import type {
  BlockFilter,
  Chain,
  Contract,
  EventCallback,
  FilterAddress,
  IndexingBuild,
  IndexingFunctions,
  LightBlock,
  LogFilter,
  SetupCallback,
  SyncBlock,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import { eth_getBlockByNumber } from "@/rpc/actions.js";
import { type Rpc, createRpc } from "@/rpc/index.js";
import {
  defaultBlockFilterInclude,
  defaultLogFilterInclude,
  defaultTraceFilterInclude,
  defaultTransactionFilterInclude,
  defaultTransactionReceiptInclude,
  defaultTransferFilterInclude,
} from "@/runtime/filter.js";
import { buildTopics, toSafeName } from "@/utils/abi.js";
import { hyperliquidEvm, chains as viemChains } from "@/utils/chains.js";
import { dedupe } from "@/utils/dedupe.js";
import { getFinalityBlockCount } from "@/utils/finality.js";
import { toLowerCase } from "@/utils/lowercase.js";
import {
  type Abi,
  type AbiEvent,
  type AbiFunction,
  type Address,
  BlockNotFoundError,
  type Hex,
  type LogTopic,
  hexToNumber,
  numberToHex,
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
      if (typeof source.chain === "object") {
        return Object.entries(source.chain).map(([chain, sourceOverride]) => {
          const { chain: _chain, ...base } = source;

          return {
            name,
            chain,
            ...base,
            ...sourceOverride,
          };
        });
      } else {
        // Handles string, null, or undefined
        return {
          name,
          ...source,
        };
      }
    },
  );
};

export async function buildIndexingFunctions({
  common,
  config,
  indexingFunctions,
  configBuild: { chains, rpcs },
}: {
  common: Common;
  config: Config;
  indexingFunctions: IndexingFunctions;
  configBuild: Pick<IndexingBuild, "chains" | "rpcs">;
}): Promise<{
  chains: Chain[];
  rpcs: Rpc[];
  finalizedBlocks: LightBlock[];
  eventCallbacks: EventCallback[][];
  setupCallbacks: SetupCallback[][];
  contracts: {
    [name: string]: {
      abi: Abi;
      address?: Address | readonly Address[];
      startBlock?: number;
      endBlock?: number;
    };
  }[];
  logs: ({ level: "warn" | "info" | "debug"; msg: string } & Record<
    string,
    unknown
  >)[];
}> {
  const context = { logger: common.logger.child({ action: "build" }) };

  const logs: ({ level: "warn" | "info" | "debug"; msg: string } & Record<
    string,
    unknown
  >)[] = [];

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
      if (perChainLatestBlockNumber.has(chain.name)) {
        return perChainLatestBlockNumber.get(chain.name)!;
      } else {
        const rpc = rpcs[chains.findIndex((c) => c.name === chain.name)]!;
        const blockPromise = rpc
          .request(
            {
              method: "eth_getBlockByNumber",
              params: ["latest", false],
            },
            context,
          )
          .then((block) => {
            if (!block)
              throw new BlockNotFoundError({ blockNumber: "latest" as any });
            return hexToNumber((block as SyncBlock).number);
          })
          .catch((e) => {
            throw new Error(
              `Unable to fetch "latest" block for chain '${chain.name}':\n${e.message}`,
            );
          });
        perChainLatestBlockNumber.set(chain.name, blockPromise);
        return blockPromise;
      }
    }

    return blockNumberOrTag;
  };

  const finalizedBlocks = await Promise.all(
    chains.map((chain) => {
      const rpc = rpcs[chains.findIndex((c) => c.name === chain.name)]!;
      const blockPromise = eth_getBlockByNumber(rpc, ["latest", false], {
        ...context,
        retryNullBlockRequest: true,
      })
        .then((block) => hexToNumber((block as SyncBlock).number))
        .catch((e) => {
          throw new Error(
            `Unable to fetch "latest" block for chain '${chain.name}':\n${e.message}`,
          );
        });

      perChainLatestBlockNumber.set(chain.name, blockPromise);

      return blockPromise.then((latest) =>
        eth_getBlockByNumber(
          rpc,
          [numberToHex(Math.max(latest - chain.finalityBlockCount, 0)), false],
          { ...context, retryNullBlockRequest: true },
        ).then((block) => ({
          hash: block.hash,
          parentHash: block.parentHash,
          number: block.number,
          timestamp: block.timestamp,
        })),
      );
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
        `Validation failed: Duplicate name '${source}' not allowed. The name must be unique across blocks, contracts, and accounts.`,
      );
    }
    sourceNames.add(source);
  }

  // Validate and build indexing functions
  if (indexingFunctions.length === 0) {
    throw new Error(
      "Validation failed: Found 0 registered indexing functions.",
    );
  }

  const eventNames = new Set<string>();

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

    if (eventNames.has(eventName)) {
      throw new Error(
        `Validation failed: Multiple indexing functions registered for event '${eventName}'.`,
      );
    }

    eventNames.add(eventName);

    // Validate that the indexing function uses a sourceName that is present in the config.
    const matchedSourceName = Object.keys({
      ...(config.contracts ?? {}),
      ...(config.accounts ?? {}),
      ...(config.blocks ?? {}),
    }).find((_sourceName) => _sourceName === sourceName);

    if (!matchedSourceName) {
      throw new Error(
        `Validation failed: Invalid event '${eventName}' uses an unrecognized contract, account, or block interval name. Expected one of [${Array.from(
          sourceNames,
        )
          .map((n) => `'${n}'`)
          .join(", ")}].`,
      );
    }
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
          .map((n) => `'${n.name}'`)
          .join(
            ", ",
          )}]. Did you forget to change 'network' to 'chain' when migrating to 0.11?`,
      );
    }

    const chain = chains.find((n) => n.name === source.chain);
    if (!chain) {
      throw new Error(
        `Validation failed: Invalid chain for '${
          source.name
        }'. Got '${source.chain}', expected one of [${chains
          .map((n) => `'${n.name}'`)
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

    if (startBlock !== undefined && Number.isInteger(startBlock) === false) {
      throw new Error(
        `Validation failed: Invalid start block for '${source.name}'. Got ${startBlock} typeof ${typeof startBlock}, expected an integer.`,
      );
    }

    if (endBlock !== undefined && Number.isInteger(endBlock) === false) {
      throw new Error(
        `Validation failed: Invalid end block for '${source.name}'. Got ${endBlock} typeof ${typeof endBlock}, expected an integer.`,
      );
    }

    if (
      "address" in source &&
      typeof source.address === "object" &&
      !Array.isArray(source.address)
    ) {
      const factoryStartBlock =
        (await resolveBlockNumber(source.address.startBlock, chain)) ??
        startBlock;

      const factoryEndBlock =
        (await resolveBlockNumber(source.address.endBlock, chain)) ?? endBlock;

      if (
        factoryStartBlock !== undefined &&
        (startBlock === undefined || factoryStartBlock > startBlock)
      ) {
        throw new Error(
          `Validation failed: Start block for '${source.name}' is before start block of factory address (${factoryStartBlock} > ${startBlock}).`,
        );
      }

      if (
        endBlock !== undefined &&
        (factoryEndBlock === undefined || factoryEndBlock > endBlock)
      ) {
        throw new Error(
          `Validation failed: End block for ${source.name}  is before end block of factory address (${factoryEndBlock} > ${endBlock}).`,
        );
      }

      if (
        factoryStartBlock !== undefined &&
        factoryEndBlock !== undefined &&
        factoryEndBlock < factoryStartBlock
      ) {
        throw new Error(
          `Validation failed: Start block for '${source.name}' factory address is after end block (${factoryStartBlock} > ${factoryEndBlock}).`,
        );
      }
    }
  }

  const perChainEventCallbacks: Map<number, EventCallback[]> = new Map();
  const perChainSetupCallbacks: Map<number, SetupCallback[]> = new Map();
  const perChainContracts: Map<
    number,
    {
      [name: string]: Contract;
    }
  > = new Map();
  for (const chain of chains) {
    perChainEventCallbacks.set(chain.id, []);
    perChainSetupCallbacks.set(chain.id, []);
    perChainContracts.set(chain.id, {});
  }

  for (const source of flattenSources(config.contracts ?? {})) {
    const chain = chains.find((n) => n.name === source.chain)!;

    const fromBlock = await resolveBlockNumber(source.startBlock, chain);
    const toBlock = await resolveBlockNumber(source.endBlock, chain);

    if (indexingFunctions.some((f) => f.name === `${source.name}:setup`)) {
      perChainSetupCallbacks.get(chain.id)!.push({
        name: `${source.name}:setup`,
        fn: indexingFunctions.find((f) => f.name === `${source.name}:setup`)!
          .fn,
        chain,
        block: fromBlock,
      });
    }

    let address: FilterAddress;

    const resolvedAddress = source?.address;
    if (
      typeof resolvedAddress === "object" &&
      Array.isArray(resolvedAddress) === false
    ) {
      const factoryAddress = resolvedAddress as Factory;
      const factoryFromBlock =
        (await resolveBlockNumber(factoryAddress.startBlock, chain)) ??
        fromBlock;

      const factoryToBlock =
        (await resolveBlockNumber(factoryAddress.endBlock, chain)) ?? toBlock;

      // Note that this can throw.
      const logFactory = buildLogFactory({
        chainId: chain.id,
        sourceId: source.name,
        ...factoryAddress,
        fromBlock: factoryFromBlock,
        toBlock: factoryToBlock,
      });

      perChainContracts.get(chain.id)![source.name] = {
        abi: source.abi,
        address: undefined,
        startBlock: fromBlock,
        endBlock: toBlock,
      };

      address = logFactory;
    } else {
      if (resolvedAddress !== undefined) {
        for (const address of Array.isArray(resolvedAddress)
          ? resolvedAddress
          : [resolvedAddress as Address]) {
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
          ? toLowerCase(resolvedAddress as Address)
          : undefined;

      perChainContracts.get(chain.id)![source.name] = {
        abi: source.abi,
        address: validatedAddress,
        startBlock: fromBlock,
        endBlock: toBlock,
      };

      address = validatedAddress;
    }

    const filteredEventSelectors = new Map<
      Hex,
      ReturnType<typeof buildTopics>[number]
    >();

    if (source.filter) {
      const eventFilters = Array.isArray(source.filter)
        ? source.filter
        : [source.filter];

      for (const filter of eventFilters) {
        const abiEvent = source.abi.find(
          (item): item is AbiEvent =>
            item.type === "event" &&
            toSafeName({ abi: source.abi, item }) === filter.event,
        );
        if (!abiEvent) {
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
      const topics = buildTopics(source.abi, eventFilters);

      for (const { topic0, topic1, topic2, topic3 } of topics) {
        const abiItem = source.abi.find(
          (item): item is AbiEvent =>
            item.type === "event" && toEventSelector(item) === topic0,
        )!;
        const indexingFunction = indexingFunctions.find(
          (f) => f.name === `${source.name}:${abiItem.name}`,
        );

        if (indexingFunction === undefined) {
          throw new Error(
            `Validation failed: Event selector '${toSafeName({ abi: source.abi, item: abiItem })}' is used in a filter but does not have a corresponding indexing function.`,
          );
        }

        filteredEventSelectors.set(topic0, { topic0, topic1, topic2, topic3 });
      }
    }

    const registeredLogEvents: string[] = [];
    const registeredCallTraceEvents: string[] = [];
    for (const { name: eventName } of indexingFunctions) {
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

      // trace event
      if (eventName.includes(".")) {
        const [functionContractName, functionName] = eventName.split(".") as [
          string,
          string,
        ];

        if (source.includeCallTraces !== true) {
          continue;
        }
        if (functionContractName === source.name) {
          registeredCallTraceEvents.push(functionName);
        }
      }
    }

    for (const logEventName of registeredLogEvents) {
      const abiEvent = source.abi.find(
        (item): item is AbiEvent =>
          item.type === "event" &&
          toSafeName({ abi: source.abi, item }) === logEventName,
      );
      if (abiEvent === undefined) {
        throw new Error(
          `Validation failed: Event name for event '${logEventName}' not found in the contract ABI. Got '${logEventName}', expected one of [${source.abi
            .filter((item): item is AbiEvent => item.type === "event")
            .map((item) => `'${toSafeName({ abi: source.abi, item })}'`)
            .join(", ")}].`,
        );
      }

      const eventName = `${source.name}:${logEventName}`;

      const indexingFunction = indexingFunctions.find(
        (f) => f.name === eventName,
      )!;

      let topic1: LogTopic;
      let topic2: LogTopic;
      let topic3: LogTopic;

      const eventSelector = toEventSelector(abiEvent);

      if (filteredEventSelectors.has(eventSelector)) {
        topic1 = filteredEventSelectors.get(eventSelector)!.topic1;
        topic2 = filteredEventSelectors.get(eventSelector)!.topic2;
        topic3 = filteredEventSelectors.get(eventSelector)!.topic3;
      } else {
        topic1 = null;
        topic2 = null;
        topic3 = null;
      }

      const filter = {
        type: "log",
        chainId: chain.id,
        sourceId: source.name,
        address,
        topic0: eventSelector,
        topic1,
        topic2,
        topic3,
        fromBlock,
        toBlock,
        hasTransactionReceipt: source.includeTransactionReceipts ?? false,
        include: defaultLogFilterInclude.concat(
          source.includeTransactionReceipts
            ? defaultTransactionReceiptInclude.map(
                (value) => `transactionReceipt.${value}` as const,
              )
            : [],
        ),
      } satisfies LogFilter;

      const eventCallback = {
        filter,
        name: eventName,
        fn: indexingFunction.fn,
        chain,
        type: "contract",
        abiItem: abiEvent,
        metadata: {
          safeName: logEventName,
          abi: source.abi,
        },
      } satisfies EventCallback;

      perChainEventCallbacks.get(chain.id)!.push(eventCallback);
    }

    for (const functionEventName of registeredCallTraceEvents) {
      const abiFunction = source.abi.find(
        (item): item is AbiFunction =>
          item.type === "function" &&
          toSafeName({ abi: source.abi, item }) === functionEventName,
      );
      if (abiFunction === undefined) {
        throw new Error(
          `Validation failed: Function name for function '${functionEventName}' not found in the contract ABI. Got '${functionEventName}', expected one of [${source.abi
            .filter((item): item is AbiFunction => item.type === "function")
            .map((item) => `'${toSafeName({ abi: source.abi, item })}'`)
            .join(", ")}].`,
        );
      }

      const eventName = `${source.name}.${functionEventName}`;

      const indexingFunction = indexingFunctions.find(
        (f) => f.name === eventName,
      )!;

      const filter = {
        type: "trace",
        chainId: chain.id,
        sourceId: source.name,
        fromAddress: undefined,
        toAddress: address,
        callType: "CALL",
        functionSelector: toFunctionSelector(abiFunction),
        includeReverted: false,
        fromBlock,
        toBlock,
        hasTransactionReceipt: source.includeTransactionReceipts ?? false,
        include: defaultTraceFilterInclude.concat(
          source.includeTransactionReceipts
            ? defaultTransactionReceiptInclude.map(
                (value) => `transactionReceipt.${value}` as const,
              )
            : [],
        ),
      } satisfies TraceFilter;

      const eventCallback = {
        filter,
        name: eventName,
        fn: indexingFunction.fn,
        chain,
        type: "contract",
        abiItem: abiFunction,
        metadata: {
          safeName: functionEventName,
          abi: source.abi,
        },
      } satisfies EventCallback;

      perChainEventCallbacks.get(chain.id)!.push(eventCallback);
    }

    if (
      registeredLogEvents.length === 0 &&
      registeredCallTraceEvents.length === 0
    ) {
      logs.push({
        level: "warn",
        msg: "No registered indexing functions",
        name: source.name,
        type: "contract",
      });
    }
  }

  for (const source of flattenSources(config.accounts ?? {})) {
    const chain = chains.find((n) => n.name === source.chain)!;

    const fromBlock = await resolveBlockNumber(source.startBlock, chain);
    const toBlock = await resolveBlockNumber(source.endBlock, chain);

    const resolvedAddress = source?.address;
    if (resolvedAddress === undefined) {
      throw new Error(
        `Validation failed: Account '${source.name}' must specify an 'address'.`,
      );
    }

    let address: FilterAddress;

    if (
      typeof resolvedAddress === "object" &&
      !Array.isArray(resolvedAddress)
    ) {
      const factoryFromBlock =
        (await resolveBlockNumber(resolvedAddress.startBlock, chain)) ??
        fromBlock;

      const factoryToBlock =
        (await resolveBlockNumber(resolvedAddress.endBlock, chain)) ?? toBlock;

      // Note that this can throw.
      const logFactory = buildLogFactory({
        chainId: chain.id,
        sourceId: source.name,
        ...resolvedAddress,
        fromBlock: factoryFromBlock,
        toBlock: factoryToBlock,
      });

      address = logFactory;
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

      address = validatedAddress;
    }

    const filters = [
      {
        type: "transaction",
        chainId: chain.id,
        sourceId: source.name,
        fromAddress: undefined,
        toAddress: address,
        includeReverted: false,
        fromBlock,
        toBlock,
        hasTransactionReceipt: true,
        include: defaultTransactionFilterInclude,
      },
      {
        type: "transaction",
        chainId: chain.id,
        sourceId: source.name,
        fromAddress: address,
        toAddress: undefined,
        includeReverted: false,
        fromBlock,
        toBlock,
        hasTransactionReceipt: true,
        include: defaultTransactionFilterInclude,
      },
      {
        type: "transfer",
        chainId: chain.id,
        sourceId: source.name,
        fromAddress: undefined,
        toAddress: address,
        includeReverted: false,
        fromBlock,
        toBlock,
        hasTransactionReceipt: source.includeTransactionReceipts ?? false,
        include: defaultTransferFilterInclude.concat(
          source.includeTransactionReceipts
            ? defaultTransactionReceiptInclude.map(
                (value) => `transactionReceipt.${value}` as const,
              )
            : [],
        ),
      },
      {
        type: "transfer",
        chainId: chain.id,
        sourceId: source.name,
        fromAddress: address,
        toAddress: undefined,
        includeReverted: false,
        fromBlock,
        toBlock,
        hasTransactionReceipt: source.includeTransactionReceipts ?? false,
        include: defaultTransferFilterInclude.concat(
          source.includeTransactionReceipts
            ? defaultTransactionReceiptInclude.map(
                (value) => `transactionReceipt.${value}` as const,
              )
            : [],
        ),
      },
    ] satisfies [
      TransactionFilter,
      TransactionFilter,
      TransferFilter,
      TransferFilter,
    ];

    let hasRegisteredIndexingFunction = false;

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
        hasRegisteredIndexingFunction = true;

        const eventCallback = {
          filter,
          name: eventName,
          fn: indexingFunction.fn,
          chain,
          type: "account",
          direction: filter.fromAddress === undefined ? "to" : "from",
        } satisfies EventCallback;

        perChainEventCallbacks.get(chain.id)!.push(eventCallback);
      }
    }

    if (hasRegisteredIndexingFunction === false) {
      logs.push({
        level: "warn",
        msg: "No registered indexing functions",
        name: source.name,
        type: "account",
      });
    }
  }

  for (const source of flattenSources(config.blocks ?? {})) {
    const chain = chains.find((n) => n.name === source.chain)!;

    const intervalMaybeNan = source.interval ?? 1;
    const interval = Number.isNaN(intervalMaybeNan) ? 0 : intervalMaybeNan;

    if (!Number.isInteger(interval) || interval === 0) {
      throw new Error(
        `Validation failed: Invalid interval for block interval '${source.name}'. Got ${interval}, expected a non-zero integer.`,
      );
    }

    const fromBlock = await resolveBlockNumber(source.startBlock, chain);
    const toBlock = await resolveBlockNumber(source.endBlock, chain);

    const eventName = `${source.name}:block`;

    const indexingFunction = indexingFunctions.find(
      (f) => f.name === eventName,
    );

    if (indexingFunction) {
      const filter = {
        type: "block",
        chainId: chain.id,
        sourceId: source.name,
        interval: interval,
        offset: (fromBlock ?? 0) % interval,
        fromBlock,
        toBlock,
        hasTransactionReceipt: false,
        include: defaultBlockFilterInclude,
      } satisfies BlockFilter;

      const eventCallback = {
        filter,
        name: eventName,
        fn: indexingFunction.fn,
        chain,
        type: "block",
      } satisfies EventCallback;

      perChainEventCallbacks.get(chain.id)!.push(eventCallback);
    } else {
      logs.push({
        level: "warn",
        msg: "No registered indexing functions",
        name: source.name,
        type: "block",
      });
    }
  }

  // Filter out any chains that don't have any sources registered.
  const chainsWithSources: Chain[] = [];
  const rpcsWithSources: Rpc[] = [];
  const finalizedBlocksWithSources: LightBlock[] = [];
  const eventCallbacksWithSources: EventCallback[][] = [];
  const setupCallbacksWithSources: SetupCallback[][] = [];
  const contractsWithSources: { [name: string]: Contract }[] = [];

  for (let i = 0; i < chains.length; i++) {
    const chain = chains[i]!;
    const rpc = rpcs[i]!;
    const hasIndexingFunctions =
      perChainEventCallbacks.get(chain.id)!.length > 0 ||
      perChainSetupCallbacks.get(chain.id)!.length > 0;

    if (hasIndexingFunctions) {
      chainsWithSources.push(chain);
      rpcsWithSources.push(rpc);
      finalizedBlocksWithSources.push(finalizedBlocks[i]!);
      eventCallbacksWithSources.push(perChainEventCallbacks.get(chain.id)!);
      setupCallbacksWithSources.push(perChainSetupCallbacks.get(chain.id)!);
      contractsWithSources.push(perChainContracts.get(chain.id)!);
    } else {
      logs.push({
        level: "warn",
        msg: "No registered indexing functions",
        chain: chain.name,
        chain_id: chain.id,
      });
    }
  }

  if (chainsWithSources.length === 0) {
    throw new Error(
      "Validation failed: Found 0 chains with registered indexing functions.",
    );
  }

  return {
    chains: chainsWithSources,
    rpcs: rpcsWithSources,
    finalizedBlocks: finalizedBlocksWithSources,
    eventCallbacks: eventCallbacksWithSources,
    setupCallbacks: setupCallbacksWithSources,
    contracts: contractsWithSources,
    logs,
  };
}

export function buildConfig({
  common,
  config,
}: { common: Common; config: Config }): {
  chains: Chain[];
  rpcs: Rpc[];
  logs: ({ level: "warn" | "info" | "debug"; msg: string } & Record<
    string,
    unknown
  >)[];
} {
  const logs: ({ level: "warn" | "info" | "debug"; msg: string } & Record<
    string,
    unknown
  >)[] = [];

  const chains: Chain[] = Object.entries(config.chains).map(
    ([chainName, chain]) => {
      let matchedChain = Object.values(viemChains).find((c) =>
        "id" in c ? c.id === chain.id : false,
      );
      if (chain.id === 999) {
        matchedChain = hyperliquidEvm;
      }

      if (chain.rpc === undefined || chain.rpc === "") {
        if (matchedChain === undefined) {
          throw new Error(
            `Chain "${chainName}" with id ${chain.id} has no RPC defined and no default RPC URL was found in 'viem/chains'.`,
          );
        }

        chain.rpc = matchedChain.rpcUrls.default.http as string[];
      }

      if (typeof chain.rpc === "string" || Array.isArray(chain.rpc)) {
        const rpcs = Array.isArray(chain.rpc) ? chain.rpc : [chain.rpc];

        if (rpcs.length === 0) {
          throw new Error(
            `Chain "${chainName}" with id ${chain.id} has no RPC URLs.`,
          );
        }

        if (matchedChain) {
          for (const rpc of rpcs) {
            for (const http of matchedChain.rpcUrls.default.http) {
              if (http === rpc) {
                logs.push({
                  level: "warn",
                  msg: "Detected public RPC URL. Most apps require an RPC URL with a higher rate limit.",
                  chain: chainName,
                  chain_id: chain.id,
                  url: http,
                });
                break;
              }
            }
            for (const ws of matchedChain.rpcUrls.default.webSocket ?? []) {
              if (ws === rpc) {
                logs.push({
                  level: "warn",
                  msg: "Detected public RPC URL. Most apps require an RPC URL with a higher rate limit.",
                  chain: chainName,
                  chain_id: chain.id,
                  url: ws,
                });
                break;
              }
            }
          }
        }
      }

      if (chain.pollingInterval !== undefined && chain.pollingInterval! < 100) {
        throw new Error(
          `Invalid 'pollingInterval' for chain '${chainName}. Expected 100 milliseconds or greater, got ${chain.pollingInterval} milliseconds.`,
        );
      }

      return {
        id: chain.id,
        name: chainName,
        rpc: chain.rpc,
        ws: chain.ws,
        pollingInterval: chain.pollingInterval ?? 1_000,
        finalityBlockCount: getFinalityBlockCount({ chain: matchedChain }),
        disableCache: chain.disableCache ?? false,
        ethGetLogsBlockRange: chain.ethGetLogsBlockRange,
        viemChain: matchedChain,
      } satisfies Chain;
    },
  );

  const chainIds = new Set<number>();
  for (const chain of chains) {
    if (chainIds.has(chain.id)) {
      throw new Error(
        `Invalid id for chain "${chain.name}". ${chain.id} is already in use.`,
      );
    }
    chainIds.add(chain.id);
  }

  const rpcs = chains.map((chain) =>
    createRpc({
      common,
      chain,
      concurrency: Math.floor(common.options.rpcMaxConcurrency / chains.length),
    }),
  );

  return { chains, rpcs, logs };
}

export async function safeBuildIndexingFunctions({
  common,
  config,
  indexingFunctions,
  configBuild,
}: {
  common: Common;
  config: Config;
  indexingFunctions: IndexingFunctions;
  configBuild: Pick<IndexingBuild, "chains" | "rpcs">;
}) {
  try {
    const result = await buildIndexingFunctions({
      common,
      config,
      indexingFunctions,
      configBuild,
    });

    return {
      status: "success",
      chains: result.chains,
      rpcs: result.rpcs,
      finalizedBlocks: result.finalizedBlocks,
      eventCallbacks: result.eventCallbacks,
      setupCallbacks: result.setupCallbacks,
      contracts: result.contracts,
      logs: result.logs,
    } as const;
  } catch (_error) {
    const buildError = new BuildError((_error as Error).message);
    buildError.stack = undefined;
    return { status: "error", error: buildError } as const;
  }
}

export function safeBuildConfig({
  common,
  config,
}: { common: Common; config: Config }) {
  try {
    const result = buildConfig({ common, config });

    return {
      status: "success",
      chains: result.chains,
      rpcs: result.rpcs,
      logs: result.logs,
    } as const;
  } catch (_error) {
    const buildError = new BuildError((_error as Error).message);
    buildError.stack = undefined;
    return { status: "error", error: buildError } as const;
  }
}
