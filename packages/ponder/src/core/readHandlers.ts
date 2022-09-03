import { build } from "esbuild";
import type { Contract } from "ethers";
import path from "node:path";
import { CONFIG } from "@/common/config";

import { logger } from "@/common/logger";

// Handler context types
export type EntityInstance = { [key: string]: string | number | null };
export type EntityModel = {
  get: (id: string) => Promise<EntityInstance | null>;
  insert: (
    obj: {
      id: string;
    } & Partial<EntityInstance>
  ) => Promise<EntityInstance>;
  upsert: (
    obj: {
      id: string;
    } & Partial<EntityInstance>
  ) => Promise<EntityInstance>;
  delete: (id: string) => Promise<void>;
};

export type HandlerContext = {
  entities: Record<string, EntityModel | undefined>;
  contracts: Record<string, Contract | undefined>;
};

// Handler types
export type Handler = (
  args: unknown,
  context: HandlerContext
) => Promise<void> | void;
export type SourceHandlers = { [eventName: string]: Handler | undefined };
export type Handlers = { [sourceName: string]: SourceHandlers | undefined };

export const readHandlers = async (): Promise<Handlers> => {
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
