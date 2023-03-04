import { StaticJsonRpcProvider } from "@ethersproject/providers";
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PonderOptions } from "@/config/options";
import { ResolvedPonderConfig } from "@/config/ponderConfig";

export type Network = {
  name: string;
  chainId: number;
  rpcUrl?: string;
  provider: StaticJsonRpcProvider;
};

export type Contract = {
  name: string;
  address: string;
  network: Network;

  abi: any; // This is the ABI as an object.
  abiFilePath?: string;
  abiInterface: ethers.utils.Interface;

  startBlock: number;
  endBlock?: number;
  blockLimit: number;

  isIndexed: boolean;
};

const providers: Record<number, StaticJsonRpcProvider | undefined> = {};

export function buildContracts({
  config,
  options,
}: {
  config: ResolvedPonderConfig;
  options: PonderOptions;
}): Contract[] {
  return config.contracts.map((contract) => {
    let abiFilePath: string | undefined;
    let abiObject: any;

    // Get the contract ABI.
    if (typeof contract.abi === "string") {
      // If it's a string, assume it's a file path.
      abiFilePath = path.isAbsolute(contract.abi)
        ? contract.abi
        : path.join(
            path.dirname(options.PONDER_CONFIG_FILE_PATH),
            contract.abi
          );

      const abiString = readFileSync(abiFilePath, "utf-8");
      abiObject = JSON.parse(abiString);
    } else {
      // If it's not a string, assume it's the ABI itself.
      abiObject = contract.abi;
    }

    // Handle the case where the ABI is actually the `abi` property of an object. Hardhat emits ABIs like this.
    const abi = abiObject?.abi ? abiObject.abi : abiObject;
    const abiInterface = new ethers.utils.Interface(abi);

    // Get the contract network/provider.
    const network = config.networks.find((n) => n.name === contract.network);
    if (!network) {
      throw new Error(
        `Network [${contract.network}] not found for contract: ${contract.name}`
      );
    }

    let provider = providers[network.chainId];
    if (!provider) {
      provider = new StaticJsonRpcProvider(network.rpcUrl, network.chainId);
      providers[network.chainId] = provider;
    }

    return {
      name: contract.name,
      address: contract.address.toLowerCase(),

      network: {
        name: network.name,
        chainId: network.chainId,
        rpcUrl: network.rpcUrl,
        provider,
      },

      abi,
      abiFilePath: abiFilePath,
      abiInterface: abiInterface,

      startBlock: contract.startBlock || 0,
      endBlock: contract.endBlock,
      blockLimit: contract.blockLimit || 50,

      isIndexed: contract.isIndexed !== undefined ? contract.isIndexed : true,
    };
  });
}
