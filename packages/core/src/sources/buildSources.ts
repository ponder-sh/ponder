import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Ponder } from "@/Ponder";

import { EvmSource } from "./evm";

export const buildSources = ({ ponder }: { ponder: Ponder }) => {
  const sources = ponder.config.sources.map((source) => {
    let abiFilePath: string | undefined;
    let abiObject: any;

    if (typeof source.abi === "string") {
      // If it's a string, assume it's a file path.
      abiFilePath = path.isAbsolute(source.abi)
        ? source.abi
        : path.join(
            path.dirname(ponder.options.PONDER_CONFIG_FILE_PATH),
            source.abi
          );

      const abiString = readFileSync(abiFilePath, "utf-8");
      abiObject = JSON.parse(abiString);
    } else {
      // If it's not a string, assume it's the ABI itself.
      abiObject = source.abi;
    }

    // Handle the case where the ABI is actually the `abi` property of an object. Hardhat emits ABIs like this.
    const abi = abiObject?.abi ? abiObject.abi : abiObject;
    const abiInterface = new ethers.utils.Interface(abi);

    const network = ponder.networks.find((n) => n.name === source.network);
    if (!network) {
      throw new Error(
        `Network [${source.network}] not found for source: ${source.name}`
      );
    }

    return new EvmSource({
      name: source.name,
      network: network,
      address: source.address,

      abiFilePath: abiFilePath,
      abi: abi,
      abiInterface: abiInterface,

      startBlock: source.startBlock,
      endBlock: source.endBlock,
      blockLimit: source.blockLimit,

      isIndexed: source.isIndexed,
    });
  });

  return sources;
};
