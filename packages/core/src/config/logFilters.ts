import { Abi, AbiEvent, Address } from "abitype";
import { encodeEventTopics } from "viem";

import { PonderOptions } from "@/config/options";
import { ResolvedPonderConfig } from "@/config/ponderConfig";

import { buildAbi } from "./abi";
import { encodeLogFilterKey } from "./encodeLogFilterKey";
import { buildNetwork, Network } from "./networks";

export type LogFilter = {
  name: string;
  network: Network;
  abi: Abi;
  filter: {
    key: string; // `${chainId}-${address}-${topics}`
    address?: `0x${string}` | `0x${string}`[];
    topics?: (`0x${string}` | `0x${string}`[] | null)[];
    event?: AbiEvent;
    args?: any[];
  };
  startBlock: number;
  endBlock: number | undefined;
  maxBlockRange: number;
};

export function buildLogFilters({
  config,
  options,
}: {
  config: ResolvedPonderConfig;
  options: PonderOptions;
}) {
  const contractLogFilters = (config.contracts ?? [])
    .filter((contract) => contract.isLogEventSource ?? true)
    .map((contract) => {
      const { abi } = buildAbi({
        abiConfig: contract.abi,
        configFilePath: options.configFile,
      });

      // Get the contract network/provider.
      const rawNetwork = config.networks.find(
        (n) => n.name === contract.network
      );
      if (!rawNetwork) {
        throw new Error(
          `Network [${contract.network}] not found for contract: ${contract.name}`
        );
      }

      const network = buildNetwork({ network: rawNetwork });

      const address = contract.address.toLowerCase() as Address;
      const topics = undefined;
      const key = encodeLogFilterKey({
        chainId: network.chainId,
        address,
        topics,
      });

      // TODO: don't store event and args here, only store topics and
      // call transport.request methods directly. Or, viem supports topics.
      const event = undefined;
      const args = undefined;

      const logFilter: LogFilter = {
        name: contract.name,
        network,
        abi,
        filter: {
          key,
          address,
          topics,
          event,
          args,
        },
        startBlock: contract.startBlock ?? 0,
        endBlock: contract.endBlock,
        maxBlockRange: contract.maxBlockRange ?? network.defaultMaxBlockRange,
      };

      return logFilter;
    });

  const filterLogFilters = (config.filters ?? []).map((filter) => {
    const { abi } = buildAbi({
      abiConfig: filter.abi,
      configFilePath: options.configFile,
    });

    // Get the contract network/provider.
    const rawNetwork = config.networks.find((n) => n.name === filter.network);
    if (!rawNetwork) {
      throw new Error(
        `Network [${filter.network}] not found for filter: ${filter.name}`
      );
    }

    const network = buildNetwork({ network: rawNetwork });

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

    // TODO: don't store event and args here, only store topics and
    // call transport.request methods directly. Or, viem supports topics.
    const event = filter.filter.event;
    const args = filter.filter.args;

    const logFilter: LogFilter = {
      name: filter.name,
      network,
      abi,
      filter: {
        key,
        address,
        topics,
        event,
        args,
      },
      startBlock: filter.startBlock ?? 0,
      endBlock: filter.endBlock,
      maxBlockRange: filter.maxBlockRange ?? network.defaultMaxBlockRange,
    };

    return logFilter;
  });

  const logFilters = contractLogFilters.concat(filterLogFilters);

  return logFilters;
}
