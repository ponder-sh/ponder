import { build } from "esbuild";
import type { Contract } from "ethers";
import path from "node:path";

import { CONFIG } from "@/common/config";
import { logger } from "@/common/logger";
import { Block, EventLog, Transaction } from "@/types";

// Handler event types
export interface HandlerEvent extends EventLog {
  block: Block;
  transaction: Transaction;
}

export type HandlerContext = {
  contracts: Record<string, Contract | undefined>;
};

// Handler types
export type Handler = (
  event: HandlerEvent,
  context: HandlerContext
) => Promise<void> | void;
export type SourceHandlers = Record<string, Handler | undefined>;
export type Handlers = Record<string, SourceHandlers | undefined>;

export const readHandlers = async (): Promise<Handlers> => {
  const buildFile = path.join(CONFIG.PONDER_DIR_PATH, "handlers.js");

  const handlersRootFilePath = path.join(CONFIG.HANDLERS_DIR_PATH, "index.ts");

  try {
    await build({
      entryPoints: [handlersRootFilePath],
      outfile: buildFile,
      platform: "node",
      bundle: true,
    });
  } catch (err) {
    logger.warn("esbuild error:", err);
  }

  // Load and then remove the module from the require cache, because we are loading
  // it several times in the same process and need the latest version each time.
  // https://ar.al/2021/02/22/cache-busting-in-node.js-dynamic-esm-imports/
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { default: rawHandlers } = require(buildFile);
  delete require.cache[require.resolve(buildFile)];

  // TODO: Validate handlers ?!?!?!
  const handlers = rawHandlers as Handlers;

  return handlers;
};
