import { AbiEvent, parseAbiItem } from "abitype";
import {
  Abi,
  Address,
  encodeEventTopics,
  getAbiItem,
  GetEventArgs,
  getEventSelector,
  Hex,
} from "viem";

import { toLowerCase } from "@/utils/lowercase";

import { AbiEvents, getEvents } from "./abi";
import { Config } from "./config";
import { buildFactoryCriteria } from "./factories";

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

export const buildSources = ({ config }: { config: Config }): Source[] => {
  const contracts = config.contracts ?? [];

  return contracts
    .map((contract) => {
      // Note: should we filter down which indexing functions are available based on the filters
      const events = getEvents({ abi: contract.abi });

      // Resolve the contract per network, filling in default values where applicable
      return contract.filters
        .map((networkContract) => {
          const network = config.networks.find(
            (n) => n.name === networkContract.name
          )!;

          const topics = networkContract.filter
            ? buildTopics(contract.abi, networkContract.filter)
            : undefined;

          const sharedSource = {
            name: contract.name,
            abi: contract.abi,
            network: network.name,
            chainId: network.chainId,
            events,
            startBlock: networkContract.startBlock ?? 0,
            endBlock: networkContract.endBlock,
            maxBlockRange: networkContract.maxBlockRange,
          } as const;

          // Check that factory and address are not both defined
          const resolvedFactory =
            "factory" in networkContract && networkContract.factory;
          const resolvedAddress =
            "address" in networkContract && networkContract.address;

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
  filter: NonNullable<
    NonNullable<Config["contracts"]>[number]["filters"][number]["filter"]
  >
): Topics => {
  if (Array.isArray(filter.event)) {
    // List of event signatures
    return [
      filter.event.map((event) => getEventSelector(findAbiEvent(abi, event))),
    ];
  } else {
    // Single event with args
    return encodeEventTopics({
      abi: [findAbiEvent(abi, filter.event)],
      args: filter.args as GetEventArgs<Abi, string>,
    });
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
