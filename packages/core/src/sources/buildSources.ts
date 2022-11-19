import { ethers } from "ethers";
import { readFileSync } from "node:fs";

import type { PonderConfig } from "@/cli/readPonderConfig";
import { Network } from "@/networks/base";

import { EvmSource } from "./evm";

export const buildSources = ({
  config,
  networks,
}: {
  config: PonderConfig;
  networks: Network[];
}) => {
  const sources = config.sources.map((source) => {
    const abiString = readFileSync(source.abi, "utf-8");
    const abiObject = JSON.parse(abiString);
    const abi = abiObject.abi ? abiObject.abi : abiObject;
    const abiInterface = new ethers.utils.Interface(abi);

    const network = networks.find((n) => n.name === source.network);
    if (!network) {
      throw new Error(
        `Network [${source.network}] not found for source: ${source.name}`
      );
    }

    return new EvmSource(
      source.name,
      network,
      source.address,
      source.abi,
      abiInterface,
      source.startBlock,
      source.blockLimit
    );
  });

  return { sources };
};
