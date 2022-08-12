import { Contract, providers } from "ethers";

import rawConfig from "../ponder.config.js";
import type { PonderConfig } from "./configParser";
import { parseConfig } from "./configParser";

const bootstrapEventData = async (config: PonderConfig) => {
  // Figure out on which block the source contract was deployed:
  config.sources.forEach(async (source) => {
    const provider = config.providers[source.chainId];
    const contract = new Contract(source.address, source.abi, provider);

    const toBlock = await contract.provider.getBlockNumber();
    console.log({ toBlock });

    const limit = 1;
    let fromBlock = 0;

    while (fromBlock <= toBlock + limit) {
      const logs = await provider.getLogs({
        address: contract.address,
        fromBlock: fromBlock,
      });

      console.log({
        fromBlock,
        logs,
      });

      fromBlock += limit;
    }
  });
};

const config = parseConfig(rawConfig);
bootstrapEventData(config);
