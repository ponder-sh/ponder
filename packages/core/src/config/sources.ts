import { Abi, Address, encodeEventTopics, Hex } from "viem";

import { toLowerCase } from "@/utils/lowercase";

import { AbiEvents, getEvents } from "./abi";
import { ResolvedConfig } from "./config";
import { buildFactoryCriteria } from "./factories";
import { Options } from "./options";

/**
 * There are up to 4 topics in an EVM event
 *
 * Technically, only the first element could be an array
 */
export type Topics = (Hex | Hex[] | null)[];

export type LogFilterCriteria = {
  address?: Address | Address[];
  topics?: Topics;
};

export type FactoryCriteria = {
  address: Address;
  eventSelector: Hex;
  childAddressLocation: "topic1" | "topic2" | "topic3" | `offset${number}`;
  topics?: Topics;
};

type BaseSource = {
  name: string;
  network: string;
  chainId: number;
  abi: Abi;
  events: AbiEvents;
  startBlock: number;
  endBlock?: number;
  maxBlockRange?: number;
};

export type LogFilter = BaseSource & {
  type: "logFilter";
  criteria: LogFilterCriteria;
};

export type Factory = BaseSource & {
  type: "factory";
  criteria: FactoryCriteria;
};

export type Source = LogFilter | Factory;

export const sourceIsLogFilter = (source: Source): source is LogFilter =>
  source.type === "logFilter";

export const sourceIsFactory = (source: Source): source is Factory =>
  source.type === "factory";

export const buildSources = ({
  config,
}: {
  config: ResolvedConfig;
  options: Options;
}): Source[] => {
  const contracts = config.contracts ?? [];

  return contracts
    .map((contract) => {
      // Note: should we filter down which indexing functions are available based on the filters
      const events = getEvents({ abi: contract.abi });

      // Resolve the contract per network, filling in default values where applicable
      return contract.network
        .map((networkContract) => {
          // Note: this is missing config validation for checking if the network is valid
          const network = config.networks.find(
            (n) => n.name === networkContract.name
          )!;

          const resolvedEvents = networkContract.event ?? contract.event;

          const topics = resolvedEvents
            ? buildTopics(resolvedEvents)
            : undefined;

          const sharedSource = {
            // constants
            name: contract.name,
            abi: contract.abi,
            network: network.name,
            chainId: network.chainId,
            events,
            // optionally overridden properties
            startBlock: networkContract.startBlock ?? contract.startBlock ?? 0,
            endBlock: networkContract.endBlock ?? contract.endBlock,
            maxBlockRange:
              networkContract.maxBlockRange ?? contract.maxBlockRange,
          } as const;

          if ("factory" in contract) {
            // factory

            return {
              ...sharedSource,
              type: "factory",
              criteria: {
                ...buildFactoryCriteria(contract.factory),
                topics,
              },
            } as const satisfies Factory;
          } else {
            // log filter

            return {
              ...sharedSource,
              type: "logFilter",
              criteria: {
                address: contract.address
                  ? toLowerCase(contract.address)
                  : undefined,
                topics,
              },
            } as const satisfies LogFilter;
          }
        })
        .flat();
    })
    .flat();
};

const buildTopics = (
  events: NonNullable<NonNullable<ResolvedConfig["contracts"]>[number]["event"]>
): Topics => {
  if (Array.isArray(events)) {
    // List of event signatures
    return [
      events
        .map((event) =>
          encodeEventTopics({
            abi: [event],
            eventName: event,
          })
        )
        .flat(),
    ];
  } else {
    // TODO:KYLE handle this once events get more complex
    return [];
    // Single event with args
    // return encodeEventTopics({
    //   abi: [events.signature],
    //   eventName: events.signature.name,
    //   args: events.args,
    // });
  }
};
