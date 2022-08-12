import type { Log } from "@ethersproject/providers";
import { BigNumber, Contract, utils } from "ethers";

import type { PonderConfig } from "./configParser";

const getInitialLogs = async (config: PonderConfig) => {
  const logs: utils.LogDescription[] = [];

  for (const source of config.sources) {
    const provider = config.providers[source.chainId];
    const contract = new Contract(source.address, source.abi, provider);

    // TODO: Figure out which block the contract was deployed on
    let fromBlock = 0;
    const toBlock = await contract.provider.getBlockNumber();
    const limit = 2000;

    while (fromBlock < toBlock) {
      const rawLogs: Log[] = await provider.send("eth_getLogs", [
        {
          address: [contract.address],
          fromBlock: BigNumber.from(fromBlock).toHexString(),
          toBlock: BigNumber.from(toBlock).toHexString(),
        },
      ]);
      const parsedLogs = rawLogs.map((log) => contract.interface.parseLog(log));
      logs.push(...parsedLogs);

      fromBlock = Math.min(fromBlock + limit, toBlock);
    }
  }

  return logs;
};

export { getInitialLogs };
