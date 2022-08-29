import { build } from "esbuild";
import path from "node:path";

import { CONFIG } from "./config";
import type { HandlerContext } from "./indexer/buildLogWorker";
import { logger } from "./utils/logger";

type Handler = (args: unknown, context: HandlerContext) => Promise<void> | void;
type SourceHandlers = { [eventName: string]: Handler | undefined };
type UserHandlers = { [sourceName: string]: SourceHandlers | undefined };

const readUserHandlers = async (): Promise<UserHandlers> => {
  const buildFile = path.join(CONFIG.PONDER_DIR_PATH, "handlers.js");

  try {
    await build({
      entryPoints: [CONFIG.HANDLERS_DIR_PATH],
      outfile: buildFile,
      platform: "node",
      bundle: true,
    });
  } catch (err) {
    logger.warn("esbuild error:", err);
  }

  const { default: rawHandlers } = await require(buildFile);
  delete require.cache[require.resolve(buildFile)];

  // TODO: Validate handlers ?!?!?!
  const handlers = rawHandlers as UserHandlers;

  return handlers;
};

export { readUserHandlers };
export type { UserHandlers };
