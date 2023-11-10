import type { AbiEvent } from "abitype";
import { parseAbiItem } from "abitype";
import type { Abi, Address, GetEventArgs, Hex } from "viem";
import { encodeEventTopics, getAbiItem, getEventSelector } from "viem";

import { toLowerCase } from "@/utils/lowercase.js";

import type { AbiEvents } from "./abi.js";
import { getEvents } from "./abi.js";
import type { Config } from "./config.js";
import { buildFactoryCriteria } from "./factories.js";

/**
 * Fix issue with Array.isArray not checking readonly arrays
 * {@link https://github.com/microsoft/TypeScript/issues/17002}
 */
declare global {
  interface ArrayConstructor {
    isArray(arg: ReadonlyArray<any> | any): arg is ReadonlyArray<any>;
  }
}

/**
 * There are up to 4 topics in an EVM log, so given that this could be more strict.
 */
export type Topics = [
  Hex | Hex[] | null,
  Hex | Hex[] | null,
  Hex | Hex[] | null,
  Hex | Hex[] | null
];

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

export const buildSources = ({ config }: { config: Config }): Source[] => {
  const contracts = config.contracts ?? [];

  return contracts
    .map((contract) => {
      // Note: should we filter down which indexing functions are available based on the filters
      const events = getEvents({ abi: contract.abi });

      // Resolve the contract per network, filling in default values where applicable
      return contract.network
        .map((networkContract) => {
          const network = config.networks.find(
            (n) => n.name === networkContract.name,
          )!;

          const resolvedFilter = networkContract.filter ?? contract.filter;

          const topics = resolvedFilter
            ? buildTopics(contract.abi, resolvedFilter)
            : undefined;

          const sharedSource = {
            name: contract.name,
            abi: contract.abi,
            network: network.name,
            chainId: network.chainId,
            events,
            startBlock: networkContract.startBlock ?? contract.startBlock ?? 0,
            endBlock: networkContract.endBlock ?? contract.endBlock,
            maxBlockRange:
              networkContract.maxBlockRange ?? contract.maxBlockRange,
          } as const;

          // Check that factory and address are not both defined
          const resolvedFactory =
            ("factory" in networkContract && networkContract.factory) ||
            ("factory" in contract && contract.factory);
          const resolvedAddress =
            ("address" in networkContract && networkContract.address) ||
            ("address" in contract && contract.address);

          if (resolvedFactory) {
            // factory

            return {
              ...sharedSource,
              type: "factory",
              criteria: {
                ...buildFactoryCriteria(resolvedFactory),
                topics,
              },
            } as const satisfies Factory;
          } else {
            // log filter

            return {
              ...sharedSource,
              type: "logFilter",
              criteria: {
                address: Array.isArray(resolvedAddress)
                  ? resolvedAddress.map((r) => toLowerCase(r))
                  : resolvedAddress
                    ? toLowerCase(resolvedAddress)
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
  abi: Abi,
  filter: NonNullable<NonNullable<Config["contracts"]>[number]["filter"]>,
): Topics => {
  if (Array.isArray(filter.event)) {
    // List of event signatures
    return [
      filter.event.map((event) => getEventSelector(findAbiEvent(abi, event))),
      null,
      null,
      null,
    ];
  } else {
    // Single event with args
    const topics = encodeEventTopics({
      abi: [findAbiEvent(abi, filter.event)],
      args: filter.args as GetEventArgs<Abi, string>,
    });
    return [
      topics[0] ?? null,
      topics[1] ?? null,
      topics[2] ?? null,
      topics[3] ?? null,
    ];
  }
};

/**
 * Finds the event ABI item for the safe event name.
 *
 * @param eventName Event name or event signature if there are collisions
 */
const findAbiEvent = (abi: Abi, eventName: string): AbiEvent => {
  if (eventName.includes("(")) {
    // Collision
    return parseAbiItem(`event ${eventName}`) as AbiEvent;
  } else {
    return getAbiItem({ abi, name: eventName }) as AbiEvent;
  }
};
