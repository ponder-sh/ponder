import { build } from "esbuild";
import path from "node:path";

import { CONFIG } from "../config";
import { logger } from "../utils/logger";
import { graphTsOverridePlugin } from "./esbuildPlugin";
import { GraphCompatPonderConfig } from "./readSubgraphYaml";

type Handler = (event: unknown) => Promise<void> | void;
type SourceHandlers = { [eventName: string]: Handler | undefined };
type GraphHandlers = { [sourceName: string]: SourceHandlers | undefined };

const readMappings = async (
  graphCompatPonderConfig: GraphCompatPonderConfig
) => {
  const buildFile = path.join(CONFIG.PONDER_DIR_PATH, "handlers.js");

  const handlers: GraphHandlers = {};

  for (const source of graphCompatPonderConfig.sources) {
    console.log(
      "attempting to esbuild mapping file at: ",
      source.mappingFilePath
    );

    try {
      await build({
        entryPoints: [source.mappingFilePath],
        outfile: buildFile,
        platform: "node",
        bundle: true,
        plugins: [graphTsOverridePlugin],
      });
    } catch (err) {
      logger.warn("esbuild error:", err);
    }

    const module = await require(buildFile);
    delete require.cache[require.resolve(buildFile)];

    const handlerFunctionMap = module as {
      [key: string]: Handler | undefined;
    };

    const sourceHandlers: SourceHandlers = {};
    source.eventHandlers.forEach(({ event, handler }) => {
      sourceHandlers[event] = handlerFunctionMap[handler];
    });

    handlers[source.name] = sourceHandlers;
  }

  console.log({ handlers });

  return handlers;
};

export { readMappings };
export type { GraphHandlers };
