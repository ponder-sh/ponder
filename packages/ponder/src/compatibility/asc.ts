import asc from "assemblyscript/cli/asc";
import fs from "node:fs";
import path from "node:path";

import type { GraphCompatPonderConfig } from "./readSubgraphYaml";

const compile = async (graphCompatPonderConfig: GraphCompatPonderConfig) => {
  for (const source of graphCompatPonderConfig.sources) {
    const inputFile = source.mappingFilePath;

    const outputFileWasm = path.resolve(
      `./.ponder/build/${source.name}/${source.name}.wasm`
    );
    const outputFileTs = path.resolve(
      `./.ponder/build/${source.name}/${source.name}.ts`
    );

    const baseDir = path.dirname(".");

    const { globalsFile, libDirs } = getLibs();

    console.log({
      inputFile,
      globalsFile,
      baseDir,
      libDirs,
      outputFileWasm,
    });

    await asc.ready;

    asc.main([
      inputFile,
      // "--explicitStart",
      // "--exportRuntime",
      // "--runtime",
      // "stub",
      "--bindings",
      "esm",
      globalsFile,
      "--baseDir",
      baseDir,
      "--lib",
      libDirs,
      "--outFile",
      outputFileWasm,
      "--optimize",
      "--debug",
    ]);
  }
};

const getLibs = () => {
  const libDirs = [];

  for (
    let dir = path.resolve(".");
    // Terminate after the root dir or when we have found node_modules
    dir !== undefined;
    // Continue with the parent directory, terminate after the root dir
    dir = path.dirname(dir) === dir ? undefined : path.dirname(dir)
  ) {
    if (fs.existsSync(path.join(dir, "node_modules"))) {
      libDirs.push(path.join(dir, "node_modules"));
    }
  }

  if (libDirs.length === 0) {
    throw Error(
      `could not locate \`node_modules\` in parent directories of subgraph manifest`
    );
  }

  const globalsFile = path.join(
    "@graphprotocol",
    "graph-ts",
    "global",
    "global.ts"
  );
  const globalsLib = libDirs.find((item) => {
    return fs.existsSync(path.join(item, globalsFile));
  });

  if (!globalsLib) {
    throw Error(
      "Could not locate `@graphprotocol/graph-ts` package in parent directories of subgraph manifest."
    );
  }

  return {
    libDirs: libDirs.join(","),
    globalsFile: path.join(globalsLib, globalsFile),
  };
};

export { compile };
