import type { Abi, Address } from "abitype";
import { type Hex, decodeEventLog, getEventSelector, RpcLog } from "viem";

import type { ResolvedConfig } from "@/config/config";
import type { Options } from "@/config/options";

import { AbiEvents, buildAbi, getEvents } from "./abi";

export type FactoryContract = {
  name: string;
  network: string;
  chainId: number;
  abi: Abi;
  address: Hex;

  startBlock: number;
  endBlock?: number;
  maxBlockRange?: number;

  childAbi: Abi;
  childEvents: AbiEvents;
  factoryEventSelector: Hex;
  getAddressFromFactoryEventLog: (log: RpcLog) => Address;
};

export function buildFactoryContracts({
  config,
  options,
}: {
  config: ResolvedConfig;
  options: Options;
}) {
  const factoryContracts = (config.factories ?? []).map((factoryContract) => {
    const { abi } = buildAbi({
      abiConfig: factoryContract.abi,
      configFilePath: options.configFile,
    });

    const factoryEventSelector = getEventSelector(factoryContract.factoryEvent);

    // TODO: Update this logic to find the childAddressTopicIndex OR childAddressDataOffset
    // from the provided config. This will be required to provide a serializable config
    // to support remote sync services. In the meantime, this simple function works.
    const getAddressFromFactoryEventLog = (log: RpcLog) => {
      // Naive validation that the user has provided a valid name for the
      // child contract address parameter.
      const factoryEventAddressParameter =
        factoryContract.factoryEvent.inputs.find(
          (i) => i.name === factoryContract.factoryEventAddressArgument
        );
      if (!factoryEventAddressParameter) {
        throw new Error(
          `Factory event address argument '${
            factoryContract.factoryEventAddressArgument
          }' not found in factory event signature. Found inputs: ${factoryContract.factoryEvent.inputs
            .map((i) => i.name)
            .join(",")}`
        );
      }

      const { args } = decodeEventLog({
        abi: [factoryContract.factoryEvent],
        topics: log.topics,
        data: log.data,
      });

      if (!(factoryContract.factoryEventAddressArgument in args)) {
        throw new Error(`Unable to decode factory event log`);
      }

      return (args as any)[
        factoryContract.factoryEventAddressArgument
      ] as Address;
    };

    const { abi: childAbi } = buildAbi({
      abiConfig: factoryContract.childAbi,
      configFilePath: options.configFile,
    });

    const childEvents = getEvents({ abi: childAbi });

    const network = config.networks.find(
      (n) => n.name === factoryContract.network
    );
    if (!network) {
      throw new Error(
        `Network [${factoryContract.network}] not found for factory contract: ${factoryContract.name}`
      );
    }

    const address = factoryContract.address.toLowerCase() as Address;

    return <FactoryContract>{
      name: factoryContract.name,
      network: network.name,
      chainId: network.chainId,
      abi,
      address,

      startBlock: factoryContract.startBlock ?? 0,
      endBlock: factoryContract.endBlock,
      maxBlockRange: factoryContract.maxBlockRange,

      childAbi,
      childEvents,
      factoryEventSelector,
      getAddressFromFactoryEventLog,
    };
  });

  return factoryContracts;
}
