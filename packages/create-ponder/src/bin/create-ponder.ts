#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

import { cac } from "cac";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import packageJson from "../../../package.json";

const cli = cac(packageJson.name)
  .version(packageJson.version)
  .usage("[options]")
  .help()
  .option("--dir [path]", "Path to directory for generated project")
  .option("--from-subgraph [path]", "Path to subgraph directory")
  .option("--from-etherscan [url]", "Link to etherscan contract page")
  .option("--etherscan-api-key [key]", "Etherscan API key");

const parsed = cli.parse(process.argv);

const options = parsed.options as {
  help?: boolean;
  dir?: string;
  fromSubgraph?: string;
  fromEtherscan?: string;
  etherscanApiKey?: string;
};

if (options.help) {
  process.exit(0);
}

// Validate CLI options.
if (options.fromSubgraph && options.fromEtherscan) {
  throw new Error(`Cannot specify more than one "--from" option:
--from-subgraph
--from-etherscan
`);
}

export interface CreatePonderOptions {
  ponderRootDir: string;
  fromSubgraph?: string;
  fromEtherscan?: string;
  etherscanApiKey?: string;
}

const validatedOptions: CreatePonderOptions = {
  // Default `dir` to "ponder".
  ponderRootDir: path.resolve(".", options.dir ? options.dir : "ponder"),
  fromSubgraph: options.fromSubgraph,
  fromEtherscan: options.fromEtherscan,
  etherscanApiKey: options.etherscanApiKey,
};

require("../index").run(validatedOptions);
