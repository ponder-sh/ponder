import type { Abi, AbiEvent, Address } from "abitype";
import { type Hex, encodeEventTopics } from "viem";

import type { ResolvedConfig } from "@/config/config.js";
import type { Options } from "@/config/options.js";

import { buildAbi, getEvents } from "./abi.js";
import { encodeLogFilterKey } from "./logFilterKey.js";

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
    // Cache key used by the event store to record what historical block ranges are available for this log filter.
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
      const key = encodeLogFilterKey({
        chainId: network.chainId,
        address,
        topics,
      });

      const logFilter: LogFilter = {
        name: contract.name,
        network: network.name,
        abi,
        events,
        maxBlockRange: contract.maxBlockRange,
        filter: {
          key,
          chainId: network.chainId,
          address,
          topics,
          startBlock: contract.startBlock ?? 0,
          endBlock: contract.endBlock,
        },
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

    const key = encodeLogFilterKey({
      chainId: network.chainId,
      address,
      topics,
    });

    const logFilter: LogFilter = {
      name: filter.name,
      network: network.name,
      abi,
      events,
      maxBlockRange: filter.maxBlockRange,
      filter: {
        key,
        chainId: network.chainId,
        address,
        topics,
        startBlock: filter.startBlock ?? 0,
        endBlock: filter.endBlock,
      },
    };

    return logFilter;
  });

  const logFilters = contractLogFilters.concat(filterLogFilters);

  return logFilters;
}
