import type { Abi, AbiEvent, Address } from "abitype";
import { type Hex, encodeEventTopics, getEventSelector } from "viem";

import type { ResolvedConfig } from "@/config/config";
import type { Options } from "@/config/options";

import { buildAbi, getEvents } from "./abi";
import { encodeLogFilterKey } from "./logFilterKey";

type SafeEventName = string;

export type LogEventMetadata = {
  // Event name (if no overloads) or full event signature (if name is overloaded).
  // This is the event name used when registering event handlers using `ponder.on("ContractName:EventName", ...)`
  safeName: string;
  // Full event signature, e.g. `event Deposit(address indexed from,bytes32 indexed id,uint value);`
  signature: string;
  // Keccak256 hash of the event signature (topic[0]).
  selector: Hex;
  // ABI item used for decoding raw logs.
  abiItem: AbiEvent;
};

export type LogFilter = {
  name: string;
  network: string;
  abi: Abi;
  maxBlockRange?: number;
  filter: {
    // Cache key used by the event store to record what block ranges have been cached for this log filter.
    key: string; // `${chainId}-${address}-${topics}`
    chainId: number;
    // See `eth_getLogs` documentation.
    address?: `0x${string}` | `0x${string}`[];
    // See `eth_getLogs` documentation.
    topics?: (`0x${string}` | `0x${string}`[] | null)[];
    // See `eth_getLogs` documentation.
    startBlock: number;
    // See `eth_getLogs` documentation.
    endBlock?: number;
  };
  // All events present in the ABI, indexed by safe event name.
  events: { [key: SafeEventName]: LogEventMetadata | undefined };
  // Whether this log filter represents a set of factory child contracts.
  isFactory: boolean;
};

export function buildLogFilters({
  config,
  options,
}: {
  config: ResolvedConfig;
  options: Options;
}) {
  const logFilters: LogFilter[] = [];

  (config.contracts ?? [])
    .filter((contract) => contract.isLogEventSource ?? true)
    .forEach((contract) => {
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
      const key = encodeLogFilterKey({
        chainId: network.chainId,
        address,
        topics,
      });

      logFilters.push({
        name: contract.name,
        network: network.name,
        abi,
        events,
        maxBlockRange: contract.maxBlockRange,
        isFactory: false,
        filter: {
          key,
          chainId: network.chainId,
          address,
          topics,
          startBlock: contract.startBlock ?? 0,
          endBlock: contract.endBlock,
        },
      });

      // If the contract had any factories, create log filters for those
      const factories = contract.factory
        ? Array.isArray(contract.factory)
          ? contract.factory
          : [contract.factory]
        : [];

      factories.forEach((factory) => {
        const { abi } = buildAbi({
          abiConfig: factory.abi,
          configFilePath: options.configFile,
        });
        const events = getEvents({ abi });

        // TODO: Support specifying address and topics on factory child log filters.
        const childAddress = undefined;
        const childTopics = undefined;
        const childKey = encodeLogFilterKey({
          chainId: network.chainId,
          address: childAddress,
          topics: childTopics,
        });

        // TODO: Make this less awful. See https://github.com/0xOlias/ponder/discussions/332
        const factoryEventSignature = getEventSelector(factory.event);
        const factoryKey = `${key}.factory_${factoryEventSignature}.${childKey}`;

        logFilters.push({
          name: factory.name,
          network: network.name,
          abi,
          events,
          maxBlockRange: factory.maxBlockRange,
          isFactory: true,
          filter: {
            key: factoryKey,
            chainId: network.chainId,
            address: childAddress,
            topics: childTopics,
            // TODO: Fix. Set this to the parent startBlock/endBlock for now.
            startBlock: contract.startBlock ?? 0,
            endBlock: contract.endBlock,
          },
        });
      });
    });

  (config.filters ?? []).forEach((filter) => {
    // Get the contract network/provider.
    const network = config.networks.find((n) => n.name === filter.network);
    if (!network) {
      throw new Error(
        `Network [${filter.network}] not found for filter: ${filter.name}`
      );
    }

    // Get the ABI and event metadata.
    const { abi } = buildAbi({
      abiConfig: filter.abi,
      configFilePath: options.configFile,
    });
    const events = getEvents({ abi });

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

    logFilters.push({
      name: filter.name,
      network: network.name,
      abi,
      events,
      maxBlockRange: filter.maxBlockRange,
      isFactory: false,
      filter: {
        key,
        chainId: network.chainId,
        address,
        topics,
        startBlock: filter.startBlock ?? 0,
        endBlock: filter.endBlock,
      },
    });

    // If the filter had any factories, create log filters for those
    const factories = filter.factory
      ? Array.isArray(filter.factory)
        ? filter.factory
        : [filter.factory]
      : [];

    factories.forEach((factory) => {
      const { abi } = buildAbi({
        abiConfig: factory.abi,
        configFilePath: options.configFile,
      });
      const events = getEvents({ abi });

      // TODO: Support specifying address and topics on factory child log filters.
      const childAddress = undefined;
      const childTopics = undefined;
      const childKey = encodeLogFilterKey({
        chainId: network.chainId,
        address: childAddress,
        topics: childTopics,
      });

      // TODO: Make this less awful. See https://github.com/0xOlias/ponder/discussions/332
      const factoryEventSignature = getEventSelector(factory.event);
      const factoryKey = `${key}.factory_${factoryEventSignature}.${childKey}`;

      logFilters.push({
        name: factory.name,
        network: network.name,
        abi,
        events,
        maxBlockRange: factory.maxBlockRange,
        isFactory: true,
        filter: {
          key: factoryKey,
          chainId: network.chainId,
          address: childAddress,
          topics: childTopics,
          // TODO: Fix. Set this to the parent startBlock/endBlock for now.
          startBlock: filter.startBlock ?? 0,
          endBlock: filter.endBlock,
        },
      });
    });
  });

  return logFilters;
}
