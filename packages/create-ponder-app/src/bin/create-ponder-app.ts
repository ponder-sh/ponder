#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

import { Command } from "commander";

const program = new Command();

program
  .description("Create a Ponder project")
  .option("--dir <string>", "Path to directory for generated Ponder project")
  .option("--from-subgraph <string>", "Path to subgraph directory");

program.parse();
const options = program.opts();

const ponderRootDir = options.dir ? options.dir : "ponder";
const subgraphRootDir = options.fromSubgraph;

require("../index").run(ponderRootDir, subgraphRootDir);
