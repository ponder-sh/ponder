#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

import { Command } from "commander";
import path from "node:path";

interface RawCreatePonderAppOptions {
  dir?: string;
  fromSubgraph?: string;
  fromEtherscan?: string;
  etherscanApiKey?: string;
}

const program = new Command();
program
  .description("Create a Ponder project")
  .option("--dir <string>", "Path to directory for generated Ponder project")
  .option("--from-subgraph <string>", "Path to subgraph directory")
  .option("--from-etherscan <string>", "Link to etherscan contract page")
  .option("--etherscan-api-key <string>", "Etherscan API key");

program.parse();
const options = program.opts() as RawCreatePonderAppOptions;

// Validate CLI options.
export interface CreatePonderAppOptions {
  ponderRootDir: string;
  fromSubgraph?: string;
  fromEtherscan?: string;
  etherscanApiKey?: string;
}

if (options.fromSubgraph && options.fromEtherscan) {
  throw new Error(`Cannot specify more than one "--from" option:
--from-subgraph
--from-etherscan
`);
}

const validatedOptions: CreatePonderAppOptions = {
  // Default `dir` to "ponder".
  ponderRootDir: path.resolve(options.dir ? options.dir : "ponder"),
  fromSubgraph: options.fromSubgraph,
  fromEtherscan: options.fromEtherscan,
  etherscanApiKey: options.etherscanApiKey,
};

require("../index").run(validatedOptions);
