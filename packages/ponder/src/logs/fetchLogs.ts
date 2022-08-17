import type { JsonRpcProvider, Log } from "@ethersproject/providers";
import { BigNumber } from "ethers";

const BLOCK_LIMIT = 2_000;

const fetchLogs = async (
  provider: JsonRpcProvider,
  contracts: string[],
  startBlock: number,
  endBlock: number
) => {
  let requestCount = 0;
  const historicalLogs: Log[] = [];

  let fromBlock = startBlock;
  let toBlock = fromBlock + BLOCK_LIMIT;

  while (fromBlock < endBlock) {
    const getLogsParams = {
      address: contracts,
      fromBlock: BigNumber.from(fromBlock).toHexString(),
      toBlock: BigNumber.from(toBlock).toHexString(),
    };

    const logs: Log[] = await provider.send("eth_getLogs", [getLogsParams]);

    fromBlock = toBlock + 1;
    toBlock = fromBlock + BLOCK_LIMIT;

    requestCount += 1;
    historicalLogs.push(...logs);
  }

  return { logs: historicalLogs, requestCount };
};

export { fetchLogs };
