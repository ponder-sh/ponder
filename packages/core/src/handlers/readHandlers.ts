import { build } from "esbuild";
import path from "node:path";

import { logger } from "@/common/logger";
import type { Block, EventLog, Transaction } from "@/common/types";
import { ensureDirExists } from "@/common/utils";
import type { Ponder } from "@/Ponder";

export interface HandlerEvent extends EventLog {
  name: string;
  block: Block;
  transaction: Transaction;
}

export type Handler = (
  event: HandlerEvent,
  context: unknown
) => Promise<void> | void;
export type SourceHandlers = Record<string, Handler | undefined>;
export type Handlers = Record<string, SourceHandlers | undefined>;

export const readHandlers = async ({ ponder }: { ponder: Ponder }) => {
  const buildFile = path.join(ponder.options.PONDER_DIR_PATH, "handlers.js");
  ensureDirExists(buildFile);

  const handlersRootFilePath = path.join(
    ponder.options.HANDLERS_DIR_PATH,
    "index.ts"
  );

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
