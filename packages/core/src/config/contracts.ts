import { Abi, Address } from "abitype";

import { PonderOptions } from "@/config/options";
import { ResolvedPonderConfig } from "@/config/ponderConfig";

import { buildAbi } from "./abi";
import { buildNetwork, Network } from "./networks";

export type Contract = {
  name: string;
  address: Address;
  network: Network;
  abi: Abi;
};

export function buildContracts({
  config,
  options,
}: {
  config: ResolvedPonderConfig;
  options: PonderOptions;
}): Contract[] {
  return (config.contracts ?? []).map((contract) => {
    const address = contract.address.toLowerCase() as Address;

    const { abi } = buildAbi({ abiConfig: contract.abi, options });

    // Get the contract network/provider.
    const rawNetwork = config.networks.find((n) => n.name === contract.network);
    if (!rawNetwork) {
      throw new Error(
        `Network [${contract.network}] not found for contract: ${contract.name}`
      );
    }

    const network = buildNetwork({ network: rawNetwork });

    return {
      name: contract.name,
      address,
      network: network,
      abi,
    };
  });
}
