import { LogDescription } from "@ethersproject/abi";
import { Block } from "@ethersproject/providers";
import { build } from "esbuild";
import type { Contract, Transaction } from "ethers";
import path from "node:path";

import { CONFIG } from "@/common/config";
import { logger } from "@/common/logger";

// Handler event types
export interface HandlerEvent extends LogDescription {
  block: Block;
  transaction: Transaction;
}

// Handler context types
export type EntityInstance = { [key: string]: string | number | null };
export type EntityModel = {
  get: (id: string) => Promise<EntityInstance | null>;
  insert: (obj: EntityInstance) => Promise<EntityInstance>;
  update: (
    obj: {
      id: string;
    } & Partial<EntityInstance>
  ) => Promise<EntityInstance>;
  upsert: (obj: EntityInstance) => Promise<EntityInstance>;
  delete: (id: string) => Promise<void>;
};

export type HandlerContext = {
  entities: Record<string, EntityModel | undefined>;
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
