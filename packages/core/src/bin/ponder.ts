#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

import { cac } from "cac";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const cli = cac("ponder")
  .usage("<command> [options]")
  .help()
  .option("--config-file [path]", `Path to config file`, {
    default: "ponder.config.js",
  })
  .option("--root-dir [path]", `Path to project root directory`, {
    default: ".",
  })
  .option("--silent [boolean]", `Command should not emit logs`, {
    default: false,
  });

export type PonderCliOptions = {
  help?: boolean;
  configFile: string;
  rootDir: string;
  silent: boolean;
};

cli
  .command("dev", "Start the development server")
  .action((options: PonderCliOptions) => {
    if (options.help) process.exit(0);

    require("../cli/dev").dev(options);
  });

cli
  .command("start", "Start the production server")
  .action((options: PonderCliOptions) => {
    if (options.help) process.exit(0);

    require("../cli/start").start(options);
  });

cli
  .command("codegen", "Emit type files, then exit")
  .action((options: PonderCliOptions) => {
    if (options.help) process.exit(0);

    require("../cli/codegen").codegen(options);
  });

cli.parse();
