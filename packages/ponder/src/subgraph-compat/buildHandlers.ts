import { injectFilePath } from "@ponder/graph-ts-ponder";
import { build } from "esbuild";
import path from "node:path";

import { graphTsOverridePlugin } from "./esbuildPlugin";
import { GraphCompatPonderConfig } from "./readSubgraphYaml";

type Handler = (event: unknown) => Promise<void> | void;
type SourceHandlers = { [eventName: string]: Handler };
type GraphHandlers = { [sourceName: string]: SourceHandlers | undefined };

const buildHandlers = async (
  graphCompatPonderConfig: GraphCompatPonderConfig
) => {
  const graphHandlers: GraphHandlers = {};

  const outFile = path.resolve(`./.ponder/handlers.js`);

  const injectedStoreFilePath = path.resolve(
    __dirname,
    "./injected/injected.js"
  );

  // This is kind of a hack to get esbuild to bundle into one file despite the fact that subgraph repos
  // don't have a one-file entrypoint (each handler defines a file that does naemd exports).
  const stdinContents = graphCompatPonderConfig.sources
    .map((source) => source.mappingFilePath)
    .map((file) => file.replace(/\.[^/.]+$/, ""))
    .map((file) => `export * from "${file}";`)
    .join("\n");

  await build({
    stdin: {
      contents: stdinContents,
      resolveDir: process.cwd(),
    },
    plugins: [graphTsOverridePlugin],
    inject: [injectFilePath, injectedStoreFilePath],
    bundle: true,
    format: "cjs",
    outfile: outFile,
  });

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const handlerFunctions = require(outFile);
  delete require.cache[require.resolve(outFile)];

  for (const source of graphCompatPonderConfig.sources) {
    const sourceHandlers: SourceHandlers = {};
    for (const eventHandler of source.eventHandlers) {
      const handler = <Handler | undefined>(
        handlerFunctions[eventHandler.handler]
      );
      if (handler) {
        sourceHandlers[eventHandler.event] = handler;
      } else {
        console.log(`Handler not found: ${eventHandler.handler}`);
      }
    }
    graphHandlers[source.name] = sourceHandlers;
  }

  return graphHandlers;
};

export { buildHandlers };
export type { GraphHandlers };
