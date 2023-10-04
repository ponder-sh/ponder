import type { Abi, Address } from "abitype";
import { type Hex, encodeEventTopics } from "viem";

import type { ResolvedConfig } from "@/config/config";
import type { Options } from "@/config/options";

import { AbiEvents, buildAbi, getEvents } from "./abi";

export type LogFilter = {
  name: string;
  network: string;
  chainId: number;
  abi: Abi;
  events: AbiEvents;
  filter: {
    address?: Hex | Hex[];
    topics?: (Hex | Hex[] | null)[];
  };
  startBlock: number;
  endBlock?: number;
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

      const events = getEvents({ abi });

      // Get the contract network/provider.
      const network = config.networks.find((n) => n.name === contract.network);
      if (!network) {
        throw new Error(
          `Network [${contract.network}] not found for contract: ${contract.name}`
        );
      }

      const address = contract.address.toLowerCase() as Address;
      const topics = undefined;

      const logFilter: LogFilter = {
        name: contract.name,
        network: network.name,
        chainId: network.chainId,
        abi,
        events,
        filter: {
          address,
          topics,
        },
        startBlock: contract.startBlock ?? 0,
        endBlock: contract.endBlock,
        maxBlockRange: contract.maxBlockRange,
      };

      return logFilter;
    });

  const filterLogFilters = (config.filters ?? []).map((filter) => {
    const { abi } = buildAbi({
      abiConfig: filter.abi,
      configFilePath: options.configFile,
    });

    const events = getEvents({ abi });

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

    const logFilter: LogFilter = {
      name: filter.name,
      network: network.name,
      chainId: network.chainId,
      abi,
      events,
      filter: {
        address,
        topics,
      },
      startBlock: filter.startBlock ?? 0,
      endBlock: filter.endBlock,
      maxBlockRange: filter.maxBlockRange,
    };

    return logFilter;
  });

  const logFilters = contractLogFilters.concat(filterLogFilters);

  return logFilters;
}
