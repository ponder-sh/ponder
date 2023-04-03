import { Abi, Address } from "abitype";
import { Hex } from "viem";

import { PonderOptions } from "@/config/options";
import { ResolvedPonderConfig } from "@/config/ponderConfig";

import { buildAbi } from "./abi";
import { buildNetwork, Network } from "./networks";

// type LogFilterArgument = Parameters<PublicClient["createEventFilter"]>[0];

export type LogFilter = {
  name: string;
  network: Network;
  abi: Abi;
  filterKey: string;
  filter: {
    address: Address | Address[];
    topics: (Hex | Hex[] | null)[] | undefined;
  };
  startBlock: number;
  endBlock: number | undefined;
  blockLimit: number;
};

export function buildLogFilters({
  config,
  options,
}: {
  config: ResolvedPonderConfig;
  options: PonderOptions;
}) {
  const contractLogFilters = config.contracts
    .filter((contract) => contract.isIndexed ?? true)
    .map((contract) => {
      const address = contract.address.toLowerCase() as Address;

      const { abi } = buildAbi({ abiConfig: contract.abi, options });

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

      const topics = undefined;
      const filterKey = `${network.chainId}-${JSON.stringify(
        address
      )}-${JSON.stringify(topics)}`;

      const logFilter: LogFilter = {
        name: contract.name,
        network,
        abi,
        filterKey,
        filter: {
          address,
          topics,
        },
        startBlock: contract.startBlock ?? 0,
        endBlock: contract.endBlock,
        blockLimit: contract.blockLimit ?? network.defaultBlockLimit,
      };

      return logFilter;
    });

  // TODO: Add arbitrary log filters.
  const logFilters = contractLogFilters;

  return logFilters;
}
