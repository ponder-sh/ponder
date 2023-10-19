import type { Abi, Address } from "abitype";
import { type Hex, encodeEventTopics } from "viem";

import type { Options } from "@/config/options";
import type { ResolvedConfig } from "@/config/types";
import { toLowerCase } from "@/utils/lowercase";

import { AbiEvents, buildAbi, getEvents } from "./abi";

export type LogFilterCriteria = {
  address?: Address | Address[];
  topics?: (Hex | Hex[] | null)[];
};

export type LogFilter = {
  name: string;
  network: string;
  chainId: number;
  criteria: LogFilterCriteria;
  abi: Abi;
  events: AbiEvents;
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
  const contracts = config.contracts ?? [];

  const contractLogFilters = contracts
    .filter(
      (
        contract
      ): contract is (typeof contracts)[number] & { address: Address } =>
        !!contract.address
    )
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

      const address = toLowerCase(contract.address);
      const topics = undefined;

      return {
        name: contract.name,
        network: network.name,
        chainId: network.chainId,
        abi,
        events,
        criteria: { address, topics },
        startBlock: contract.startBlock ?? 0,
        endBlock: contract.endBlock,
        maxBlockRange: contract.maxBlockRange,
      } satisfies LogFilter;
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
      ? filter.filter.address.map(toLowerCase)
      : typeof filter.filter.address === "string"
      ? toLowerCase(filter.filter.address)
      : undefined;

    const topics = filter.filter.event
      ? encodeEventTopics({
          abi: [filter.filter.event],
          eventName: filter.filter.event.name,
          args: filter.filter.args as any,
        })
      : undefined;

    return {
      name: filter.name,
      network: network.name,
      chainId: network.chainId,
      abi,
      events,
      criteria: { address, topics },
      startBlock: filter.startBlock ?? 0,
      endBlock: filter.endBlock,
      maxBlockRange: filter.maxBlockRange,
    } satisfies LogFilter;
  });

  return (contractLogFilters as LogFilter[]).concat(filterLogFilters);
}
