import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Network } from "@/config/networks";
import type { Ponder } from "@/Ponder";

export type ContractOptions = {
  name: string;
  network: Network;
  address: string;

  abiFilePath?: string;
  abi: any[];
  abiInterface: ethers.utils.Interface;

  startBlock?: number;
  endBlock?: number;
  blockLimit?: number;

  isIndexed?: boolean;
};

export type Contract = {
  name: string;
  network: Network;
  address: string;

  abiFilePath?: string;
  abi: any[];
  abiInterface: ethers.utils.Interface;

  startBlock: number;
  endBlock?: number;
  blockLimit: number;

  isIndexed: boolean;
};

const buildContract = (options: ContractOptions): Contract => {
  return {
    name: options.name,
    network: options.network,
    address: options.address.toLowerCase(),

    abiFilePath: options.abiFilePath,
    abi: options.abi,
    abiInterface: options.abiInterface,

    startBlock: options.startBlock || 0,
    endBlock: options.endBlock,
    blockLimit: options.blockLimit || 50,

    isIndexed: options.isIndexed !== undefined ? options.isIndexed : true,
  };
};

export const buildContracts = ({ ponder }: { ponder: Ponder }) => {
  const contracts = ponder.config.contracts.map((contract) => {
    let abiFilePath: string | undefined;
    let abiObject: any;

    if (typeof contract.abi === "string") {
      // If it's a string, assume it's a file path.
      abiFilePath = path.isAbsolute(contract.abi)
        ? contract.abi
        : path.join(
            path.dirname(ponder.options.PONDER_CONFIG_FILE_PATH),
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

    const network = ponder.networks.find((n) => n.name === contract.network);
    if (!network) {
      throw new Error(
        `Network [${contract.network}] not found for contract: ${contract.name}`
      );
    }

    return buildContract({
      name: contract.name,
      network: network,
      address: contract.address,

      abiFilePath: abiFilePath,
      abi: abi,
      abiInterface: abiInterface,

      startBlock: contract.startBlock,
      endBlock: contract.endBlock,
      blockLimit: contract.blockLimit,

      isIndexed: contract.isIndexed,
    });
  });

  return contracts;
};
