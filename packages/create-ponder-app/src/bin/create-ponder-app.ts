#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

import { Command } from "commander";

const program = new Command();

program
  .description("Create a Ponder project")
  .option("--from-subgraph <string>", "Path to subgraph directory")
  .argument("<string>", "Path to directory for generated Ponder project");

program.parse();

const args = program.args;
const options = program.opts();

const ponderRootDir = args[0] ? args[0] : "ponder";

const subgraphRootDir = options.fromSubgraph
  ? options.fromSubgraph
  : "subgraph";

require("../index").run(ponderRootDir, subgraphRootDir);
