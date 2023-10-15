import type { Abi, Address } from "abitype";
import { decodeEventLog, getEventSelector, Hex } from "viem";

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
  const factories = (config.factories ?? []).map((factory) => {
    const factoryEventSelector = getEventSelector(factory.factoryEvent);

    //   {
    //     childContractAddressTopic: 1 | 2 | 3;
    //     childContractAddressOffset?: undefined;
    // } | {
    //     childContractAddressTopic?: undefined;
    //     childContractAddressOffset: number;
    // }

    const { abi: childAbi } = buildAbi({
      abiConfig: factory.child.abi,
      configFilePath: options.configFile,
    });

    const childEvents = getEvents({ abi: childAbi });

    const network = config.networks.find((n) => n.name === factory.network);
    if (!network) {
      throw new Error(
        `Network [${factory.network}] not found for factory contract: ${factory.name}`
      );
    }

    const address = factory.address.toLowerCase() as Address;

    return <Factory>{
      name: factory.name,
      network: network.name,
      chainId: network.chainId,

      child: {
        name: factory.child.name,
        abi: childAbi,
        events: childEvents,
      },

      startBlock: factory.startBlock ?? 0,
      endBlock: factory.endBlock,
      maxBlockRange: factory.maxBlockRange,
    };
  });

  return factories;
}

function buildFactoryCriteria({}: {}) {
  const { address, eventSelector } = factory;

  // TODO: Update this logic to find the childAddressTopicIndex OR childAddressDataOffset
  // from the provided config. This will be required to provide a serializable config
  // to support remote sync services. In the meantime, this simple function works.
  // Naive validation that the user has provided a valid name for the
  // child contract address parameter.
  const factoryEventAddressParameter = factory.factoryEvent.inputs.find(
    (i) => i.name === factory.factoryEventAddressArgument
  );
  if (!factoryEventAddressParameter) {
    throw new Error(
      `Factory event address argument '${
        factory.factoryEventAddressArgument
      }' not found in factory event signature. Found inputs: ${factory.factoryEvent.inputs
        .map((i) => i.name)
        .join(",")}`
    );
  }

  const { args } = decodeEventLog({
    abi: [factory.factoryEvent],
    topics: log.topics,
    data: log.data,
  });

  if (!(factory.factoryEventAddressArgument in args)) {
    throw new Error(`Unable to decode factory event log`);
  }

  return toLowerCase(
    (args as any)[factory.factoryEventAddressArgument] as Address
  );
}

// // event PoolCreated(indexed address token0, indexed address token1, indexed uint24 fee, int24 tickSpacing, address pool)
// getAddressFromFactoryEventLog: (log: RpcLog) => {
//   const result = decodeEventLog({
//     abi: uniswapV3FactoryAbi,
//     topics: log.topics,
//     data: log.data,
//   });
//   // eslint-disable-next-line @typescript-eslint/ban-ts-comment
//   // @ts-ignore
//   return result.args.pool;
// },
