import { Abi, Address } from "abitype";
import { encodeEventTopics } from "viem";

import { ResolvedConfig } from "@/config/config";
import { Options } from "@/config/options";

import { buildAbi } from "./abi";
import { encodeLogFilterKey } from "./logFilterKey";

export type LogFilter = {
  name: string;
  abi: Abi;
  network: string;
  filter: {
    key: string; // `${chainId}-${address}-${topics}`
    chainId: number;
    address?: `0x${string}` | `0x${string}`[];
    topics?: (`0x${string}` | `0x${string}`[] | null)[];
    startBlock: number;
    endBlock?: number;
  };
  maxBlockRange?: number;
};

export function buildLogFilters({
  config,
  options,
}: {
  config: ResolvedConfig;
  options: Options;
}) {
  const contractLogFilters = (config.contracts ?? [])
    .filter((contract) => contract.isLogEventSource ?? true)
    .map((contract) => {
      const { abi } = buildAbi({
        abiConfig: contract.abi,
        configFilePath: options.configFile,
      });

      // Get the contract network/provider.
      const network = config.networks.find((n) => n.name === contract.network);
      if (!network) {
        throw new Error(
          `Network [${contract.network}] not found for contract: ${contract.name}`
        );
      }

      const address = contract.address.toLowerCase() as Address;
      const topics = undefined;
      const key = encodeLogFilterKey({
        chainId: network.chainId,
        address,
        topics,
      });

      const logFilter: LogFilter = {
        name: contract.name,
        abi,
        network: network.name,
        filter: {
          key,
          chainId: network.chainId,
          address,
          topics,
          startBlock: contract.startBlock ?? 0,
          endBlock: contract.endBlock,
        },
        maxBlockRange: contract.maxBlockRange,
      };

      return logFilter;
    });

  const filterLogFilters = (config.filters ?? []).map((filter) => {
    const { abi } = buildAbi({
      abiConfig: filter.abi,
      configFilePath: options.configFile,
    });

    // Get the contract network/provider.
    const network = config.networks.find((n) => n.name === filter.network);
    if (!network) {
      throw new Error(
        `Network [${filter.network}] not found for filter: ${filter.name}`
      );
    }

    const address = Array.isArray(filter.filter.address)
      ? filter.filter.address.map((a) => a.toLowerCase() as Address)
      : typeof filter.filter.address === "string"
      ? (filter.filter.address.toLowerCase() as Address)
      : undefined;

    const topics = filter.filter.event
      ? encodeEventTopics({
          abi: [filter.filter.event],
          eventName: filter.filter.event.name,
          args: filter.filter.args as any,
        })
      : undefined;

    const key = encodeLogFilterKey({
      chainId: network.chainId,
      address,
      topics,
    });

    const logFilter: LogFilter = {
      name: filter.name,
      abi,
      network: network.name,
      filter: {
        key,
        chainId: network.chainId,
        address,
        topics,
        startBlock: filter.startBlock ?? 0,
        endBlock: filter.endBlock,
      },
      maxBlockRange: filter.maxBlockRange,
    };

    return logFilter;
  });

  const logFilters = contractLogFilters.concat(filterLogFilters);

  return logFilters;
}
