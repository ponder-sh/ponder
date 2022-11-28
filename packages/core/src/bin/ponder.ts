#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

import { cac } from "cac";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: ".env.local" });

const cli = cac("ponder")
  .usage("<command> [options]")
  .help()
  .option(
    "--config [path]",
    `Path to config file. Default: "ponder.config.js"`
  );

type RawCliOptions = {
  help?: boolean;
  dir?: string;
  config?: string;
};

export type PonderCliOptions = {
  configFilePath: string;
};

const resolveOptions = (options: RawCliOptions): PonderCliOptions => {
  const configFilePath = path.join(
    process.cwd(),
    options.config || "ponder.config.js"
  );

  return {
    configFilePath,
  };
};

cli
  .command("dev", "Start the development server")
  .action((rawOptions: RawCliOptions) => {
    if (rawOptions.help) process.exit(0);
    const options = resolveOptions(rawOptions);

    require("../cli/dev").dev(options);
  });

cli
  .command("start", "Start the production server")
  .action((rawOptions: RawCliOptions) => {
    if (rawOptions.help) process.exit(0);
    const options = resolveOptions(rawOptions);

    require("../cli/start").start(options);
  });

cli
  .command("codegen", "Emit type files, then exit")
  .action((rawOptions: RawCliOptions) => {
    if (rawOptions.help) process.exit(0);
    const options = resolveOptions(rawOptions);

    require("../cli/codegen").codegen(options);
  });

cli.parse();
