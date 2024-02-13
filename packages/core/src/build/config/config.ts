import { buildAbiEvents, buildTopics } from "@/config/abi.js";
import type { Config } from "@/config/config.js";
import { buildFactoryCriteria } from "@/config/factories.js";
import {
  type Network,
  getDefaultMaxBlockRange,
  getFinalityBlockCount,
  getRpcUrlsForClient,
  isRpcUrlPublic,
} from "@/config/networks.js";
import { chains } from "@/utils/chains.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type {
  Factory,
  LogFilter,
  Source,
  Topics,
} from "../../config/sources.js";

export async function buildNetworksAndSources({ config }: { config: Config }) {
  const warnings: string[] = [];

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
          warnings.push(
            `Network '${networkName}' is using a public RPC URL (${rpcUrl}). Most apps require an RPC URL with a higher rate limit.`,
          );
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
        maxHistoricalTaskConcurrency: 20,
      } satisfies Network;
    }),
  );

  const sources: Source[] = Object.entries(config.contracts)
    // First, apply any network-specific overrides and flatten the result.
    .flatMap(([contractName, contract]) => {
      if (contract.network === null || contract.network === undefined) {
        throw new Error(
          `Validation failed: Network for contract '${contractName}' is null or undefined. Expected one of [${networks
            .map((n) => `'${n.name}'`)
            .join(", ")}].`,
        );
      }

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

          startBlock: contract.startBlock ?? 0,
          endBlock: contract.endBlock,
          maxBlockRange: contract.maxBlockRange,
        };
      }

      type DefinedNetworkOverride = NonNullable<
        Exclude<Config["contracts"][string]["network"], string>[string]
      >;

      // Multiple networks case.
      return Object.entries(contract.network)
        .filter((n): n is [string, DefinedNetworkOverride] => !!n[1])
        .map(([networkName, overrides]) => ({
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

          startBlock: overrides.startBlock ?? contract.startBlock ?? 0,
          endBlock: overrides.endBlock ?? contract.endBlock,
          maxBlockRange: overrides.maxBlockRange ?? contract.maxBlockRange,
        }));
    })
    // Second, build and validate the factory or log filter.
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

      // Note: This can probably throw for invalid ABIs. Consider adding explicit ABI validation before this line.
      const abiEvents = buildAbiEvents({ abi: rawContract.abi });

      let topics: Topics | undefined = undefined;

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
        // Note: This can throw.
        topics = buildTopics(rawContract.abi, rawContract.filter);
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
        const factoryCriteria = buildFactoryCriteria(resolvedFactory);

        return {
          ...baseContract,
          type: "factory",
          criteria: { ...factoryCriteria, topics },
        } satisfies Factory;
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
        type: "logFilter",
        criteria: {
          address: validatedAddress,
          topics,
        },
      } satisfies LogFilter;
    });

  return { networks, sources, warnings };
}

export async function safeBuildNetworksAndSources({
  config,
}: { config: Config }) {
  try {
    const result = await buildNetworksAndSources({ config });

    return { success: true, data: result } as const;
  } catch (error_) {
    const error = error_ as Error;
    error.stack = undefined;
    return { success: false, error } as const;
  }
}
