#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

import { cac } from "cac";
import dotenv from "dotenv";

import { Ponder } from "@/Ponder";

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
  .action(async (options: PonderCliOptions) => {
    if (options.help) process.exit(0);

    const ponder = new Ponder({ isDev: true, ...options });
    await ponder.dev();
  });

cli
  .command("start", "Start the production server")
  .action(async (options: PonderCliOptions) => {
    if (options.help) process.exit(0);

    const ponder = new Ponder({ isDev: false, ...options });
    await ponder.start();
  });

cli
  .command("codegen", "Emit type files, then exit")
  .action(async (options: PonderCliOptions) => {
    if (options.help) process.exit(0);

    const ponder = new Ponder({ isDev: true, ...options });
    ponder.codegen();
  });

cli.parse();
