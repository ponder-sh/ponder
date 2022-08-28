import { build } from "esbuild";
import path from "node:path";

import { graphTsOverridePlugin } from "./esbuildPlugin";
import { GraphCompatPonderConfig } from "./readSubgraphYaml";

type Handler = (event: unknown) => Promise<void> | void;
type SourceHandlers = { [eventName: string]: Handler };
type GraphHandlers = { [sourceName: string]: SourceHandlers | undefined };

const readMappings = async (
  graphCompatPonderConfig: GraphCompatPonderConfig
) => {
  const graphHandlers: GraphHandlers = {};

  const entryPoints = graphCompatPonderConfig.sources.map(
    (source) => source.mappingFilePath
  );
  const outFile = path.resolve(`./.ponder/handlers.js`);

  await build({
    entryPoints: entryPoints,
    plugins: [graphTsOverridePlugin],
    bundle: true,
    outfile: outFile,
  });

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const handlers = require(outFile);
  delete require.cache[require.resolve(outFile)];

  console.log(handlers);

  // for (const source of graphCompatPonderConfig.sources) {
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
  // }
  // console.log({ graphHandlers });

  return graphHandlers;
};

export { readMappings };
export type { GraphHandlers };
