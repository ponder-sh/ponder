import { readFile } from "node:fs/promises";

import { CONFIG } from "../config";
import { logger } from "../utils/logger";
import { GraphCompatPonderConfig } from "./readSubgraphYaml";

type Handler = (event: unknown) => Promise<void> | void;
type SourceHandlers = { [eventName: string]: Handler };
type GraphHandlers = { [sourceName: string]: SourceHandlers | undefined };

const readMappings = async (
  graphCompatPonderConfig: GraphCompatPonderConfig
) => {
  const graphHandlers: GraphHandlers = {};

  for (const source of graphCompatPonderConfig.sources) {
    // const wasm = await readFile(source.wasmFilePath);
    // const sourceHandlers: SourceHandlers = {};
    // for (const eventHandler of source.eventHandlers) {
    //   const handler = <Handler | undefined>(
    //     handlerFunctions[eventHandler.handler]
    //   );
    //   if (handler) {
    //     sourceHandlers[eventHandler.event] = handler;
    //   } else {
    //     logger.info(`Handler not found: ${eventHandler.handler}`);
    //   }
    // }
    // graphHandlers[source.name] = sourceHandlers;
  }

  console.log({ graphHandlers });

  return graphHandlers;
};

export { readMappings };
export type { GraphHandlers };
