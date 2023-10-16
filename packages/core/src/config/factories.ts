import type { Abi, AbiEvent, Address } from "abitype";
import { getEventSelector, Hex, RpcLog } from "viem";

import type { ResolvedConfig } from "@/config/config";
import type { Options } from "@/config/options";
import { toLowerCase } from "@/utils/lowercase";

import { AbiEvents, buildAbi, getEvents } from "./abi";

export type FactoryCriteria = {
  address: Address;
  eventSelector: Hex;
} & (
  | {
      childContractAddressTopic: 1 | 2 | 3;
      childContractAddressOffset?: never;
    }
  | {
      childContractAddressTopic?: never;
      childContractAddressOffset: number;
    }
);

export type Factory = {
  name: string;
  network: string;
  chainId: number;
  criteria: FactoryCriteria;
  abi: Abi;
  events: AbiEvents;
  startBlock: number;
  endBlock?: number;
  maxBlockRange?: number;
};

export function buildFactories({
  config,
  options,
}: {
  config: ResolvedConfig;
  options: Options;
}) {
  const contracts = config.contracts ?? [];

  const factories = contracts
    .filter(
      (
        contract
      ): contract is (typeof contracts)[number] & {
        factory: NonNullable<(typeof contracts)[number]["factory"]>;
      } => !!contract.factory
    )
    .map((contract) => {
      const criteria = buildFactoryCriteria(contract.factory);

      const { abi } = buildAbi({
        abiConfig: contract.abi,
        configFilePath: options.configFile,
      });

      const childEvents = getEvents({ abi });

      const network = config.networks.find((n) => n.name === contract.network);
      if (!network) {
        throw new Error(
          `Network [${contract.network}] not found for factory contract: ${contract.name}`
        );
      }

      return {
        name: contract.name,
        network: network.name,
        chainId: network.chainId,

        criteria,

        abi,
        events: childEvents,

        startBlock: contract.startBlock ?? 0,
        endBlock: contract.endBlock,
        maxBlockRange: contract.maxBlockRange,
      } satisfies Factory;
    });

  return factories;
}

export function buildFactoryCriteria({
  address,
  event,
  parameter,
}: {
  address: `0x${string}`;
  event: AbiEvent;
  parameter: string;
}) {
  const eventSelector = getEventSelector(event);

  // Check if the provided parameter is present in the list of indexed inputs.
  const indexedInputPosition = event.inputs
    .filter((x) => "indexed" in x && x.indexed)
    .findIndex((input) => input.name === parameter);

  if (indexedInputPosition > -1) {
    return {
      address: toLowerCase(address),
      eventSelector,
      // Add 1 because inputs will not contain an element for topic0 (the signature).
      childContractAddressTopic: (indexedInputPosition + 1) as 1 | 2 | 3,
    } satisfies FactoryCriteria;
  }

  const nonIndexedInputPosition = event.inputs
    .filter((x) => !("indexed" in x && x.indexed))
    .findIndex((input) => input.name === parameter);

  if (nonIndexedInputPosition === -1) {
    throw new Error(
      `Factory event parameter '${parameter}' not found in factory event signature. Found: ${event.inputs
        .map((i) => i.name)
        .join(", ")}.`
    );
  }

  return {
    address: toLowerCase(address),
    eventSelector,
    // The offset of the provided parameter is equal to the parameter position * 32 bytes.
    // Source: https://docs.soliditylang.org/en/develop/abi-spec.html#use-of-dynamic-types
    childContractAddressOffset: nonIndexedInputPosition * 32,
  } satisfies FactoryCriteria;
}

export function getAddressFromFactoryEventLog({
  criteria,
  log,
}: {
  criteria: FactoryCriteria;
  log: RpcLog;
}) {
  const { childContractAddressOffset, childContractAddressTopic } = criteria;

  if (childContractAddressOffset !== undefined) {
    const start = 2 + 12 * 2 + childContractAddressOffset * 2;
    const end = start + 20 * 2;
    if (log.data.length < end) {
      throw new Error(
        `Invalid log for factory criteria: Data size too small, expected at least ${
          end / 2 - 1
        } bytes`
      );
    }

    return ("0x" + log.data.slice(start, end)) as `0x${string}`;
  } else if (childContractAddressTopic !== undefined) {
    const topic = log.topics[childContractAddressTopic];
    if (topic === undefined) {
      throw new Error(
        `Invalid log for factory criteria: Not enough topic values, expected at least ${childContractAddressTopic}`
      );
    }

    const start = 2 + 12 * 2;
    const end = start + 20 * 2;

    return ("0x" + topic.slice(start, end)) as `0x${string}`;
  } else {
    throw new Error(
      `Invalid factory criteria: Missing both childContractAddressOffset and childContractAddressTopic.`
    );
  }
}
