import type { Abi, Address } from "abitype";

import type { Options } from "@/config/options";
import type { ResolvedConfig } from "@/config/types";

import { buildAbi } from "./abi";
import type { Network } from "./networks";

export type Contract = {
  name: string;
  address: Address;
  network: Network;
  abi: Abi;
};

export function buildContracts({
  config,
  options,
  networks,
}: {
  config: ResolvedConfig;
  options: Options;
  networks: Network[];
}): Contract[] {
  return (config.contracts ?? []).map((contract) => {
    const address = contract.address.toLowerCase() as Address;

    const { abi } = buildAbi({
      abiConfig: contract.abi,
      configFilePath: options.configFile,
    });

    // Get the contract network/provider.
    const network = networks.find((n) => n.name === contract.network);
    if (!network) {
      throw new Error(
        `Network [${contract.network}] not found for contract: ${contract.name}`
      );
    }

    return { name: contract.name, address, network, abi };
  });
}
