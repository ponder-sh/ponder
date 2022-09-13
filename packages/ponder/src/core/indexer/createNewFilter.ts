import type { Log } from "@ethersproject/providers";
import { BigNumber } from "ethers";
import type fastq from "fastq";

import { LogGroup } from "./executeLogs";

// const blockHandlers: { [key: string]: () => Promise<void> | undefined } = {};

export const createNewFilter = async (
  logGroup: LogGroup,
  logQueue: fastq.queueAsPromised
) => {
  const { provider, contracts } = logGroup;

  const latestBlock = await provider.getBlock("latest");
  const filterStartBlock = latestBlock.number;

  const filterId: string = await provider.send("eth_newFilter", [
    {
      fromBlock: BigNumber.from(filterStartBlock).toHexString(),
      address: contracts,
    },
  ]);

  // // If a block listener was already registered for this provider, remove it.
  // const oldBlockHandler = blockHandlers[cacheKey];
  // if (oldBlockHandler) {
  //   provider.off("block", oldBlockHandler);
  // }

  // TODO: Fix suspected issue where if the user starts and then stops using a given provider/chainId
  // during hot reloading, the stale provider's listeners never get un-registered.
  // This happens because this code only un-registers stale listeners for the current set of logGroups.

  const blockHandler = async () => {
    const logs: Log[] = await provider.send("eth_getFilterChanges", [filterId]);
    logs.forEach(logQueue.push);
  };
  provider.on("block", blockHandler);

  // blockHandlers[cacheKey] = blockHandler;

  return { filterStartBlock };
};
