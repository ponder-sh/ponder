import type { Abi, Address } from "abitype";

import type { ResolvedConfig } from "@/config/config";
import type { Options } from "@/config/options";

import { buildAbi } from "./abi";
import type { Network } from "./network";

export type Contract = {
  name: string;
  address: Address;
  network: Network;
  abi: Abi;
};

export function buildContracts({
  config,
  options,
  network,
}: {
  config: ResolvedConfig;
  options: Options;
  network: Network;
}): Contract[] {
  return (config.contracts ?? []).map((contract) => {
    const address = contract.address.toLowerCase() as Address;

    const { abi } = buildAbi({
      abiConfig: contract.abi,
      configFilePath: options.configFile,
    });

    return {
      name: contract.name,
      address,
      network: network,
      abi,
    };
  });
}
