import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import prettier from "prettier";
import type {
  PartialPonderConfig,
  PonderNetwork,
  PonderSource,
} from "src/index";

import type { CreatePonderAppOptions } from "./bin/create-ponder-app";

export const fromEtherscan = (options: CreatePonderAppOptions) => {
  if (!options.fromEtherscan) {
    throw new Error(`Internal error: fromSubgraph undefined`);
  }

  const { ponderRootDir } = options;

  const ponderNetworks: PonderNetwork[] = [];
  const ponderSources: PonderSource[] = [];

  // Build the partial ponder config.
  const ponderConfig: PartialPonderConfig = {
    plugins: ["graphqlPlugin()"],
    database: {
      kind: "sqlite",
    },
    networks: ponderNetworks,
    sources: ponderSources,
  };

  return ponderConfig;
};
