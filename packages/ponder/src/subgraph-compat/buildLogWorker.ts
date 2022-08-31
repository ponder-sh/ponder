import { Log } from "@ethersproject/providers";
import { BigNumber } from "ethers";

import type { PonderConfig } from "../readUserConfig";
import { logger } from "../utils/logger";
import { buildEvent } from "./buildEvent";
import type { GraphHandlers } from "./buildHandlers";

type LogWorker = (log: Log) => Promise<void>;

const buildLogWorker = (
  config: PonderConfig,
  handlers: GraphHandlers
): LogWorker => {
  // NOTE: This function should probably come as a standalone param.
  const worker = async (log: Log) => {
    const source = config.sources.find(
      (source) => source.address.toLowerCase() === log.address.toLowerCase()
    );
    if (!source) {
      logger.warn(`Source not found for log with address: ${log.address}`);
      return;
    }

    const parsedLog = source.abiInterface.parseLog(log);

    const sourceHandlers = handlers[source.name];
    if (!sourceHandlers) {
      logger.warn(`Handlers not found for source: ${source.name}`);
      return;
    }

    const handler = sourceHandlers[parsedLog.signature];
    if (!handler) {
      logger.warn(
        `Handler not found for event: ${source.name}-${parsedLog.signature}`
      );
      return;
    }

    const logBlockNumber = BigNumber.from(log.blockNumber).toNumber();
    logger.debug(
      `Processing ${parsedLog.signature} from block ${logBlockNumber}`
    );

    // NOTE: Not entirely sure why this is required to print logs.
    // Without the try/catch, errors throw in the handler code throw silently.
    try {
      const event = buildEvent(log, parsedLog);

      await handler(event);
    } catch (err) {
      console.error(err);
    }
  };

  return worker;
};

export { buildLogWorker };
export type { LogWorker };
