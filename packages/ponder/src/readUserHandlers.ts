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

  // // This is kind of a hack to get esbuild to bundle into one file despite the fact that subgraph repos
  // // don't have a one-file entrypoint (each handler defines a file that does naemd exports).
  // const stdinContents = config.sources
  //   .map((source) => source.mappingFilePath)
  //   .map((file) => file.replace(/\.[^/.]+$/, ""))
  //   .map((file) => `export * from "${file}";`)
  //   .join("\n");

  try {
    await build({
      // stdin: {
      //   contents: stdinContents,
      //   resolveDir: process.cwd(),
      // },
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
