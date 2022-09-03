import type { JsonRpcProvider, Log } from "@ethersproject/providers";
import { BigNumber } from "ethers";

import { logger } from "@/common/logger";

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

  const estimatedRequestCount = Math.round(
    (endBlock - startBlock) / BLOCK_LIMIT
  );

  logger.info(
    `\x1b[35m${`FETCHING LOGS IN ~${estimatedRequestCount} REQUESTS`}\x1b[0m`
  ); // magenta

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

    if (requestCount % 10 == 0) {
      logger.info(`\x1b[35m${`REQUESTS COMPLETE: ${requestCount}`}\x1b[0m`); // magenta
    }
  }

  return { logs: historicalLogs, requestCount };
};

export { fetchLogs };
