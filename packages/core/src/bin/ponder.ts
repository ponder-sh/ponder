#!/usr/bin/env node

import { cac } from "cac";
import dotenv from "dotenv";

import { registerKilledProcessListener } from "@/common/utils";
import { buildOptions } from "@/config/options";
import { buildPonderConfig } from "@/config/ponderConfig";
import { Ponder } from "@/Ponder";

import packageJson from "../../package.json" assert { type: "json" };

dotenv.config({ path: ".env.local" });

const cli = cac("ponder")
  .version(packageJson.version)
  .usage("<command> [options]")
  .help()
  .option("--config-file [path]", `Path to ponder config file`, {
    default: "ponder.config.ts",
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
  .action(async (cliOptions: PonderCliOptions) => {
    if (cliOptions.help) process.exit(0);

    const options = buildOptions({ ...cliOptions, logType: "dev" });
    const config = await buildPonderConfig(options);
    const ponder = new Ponder({ options, config });
    registerKilledProcessListener(() => ponder.kill());
    await ponder.dev();
  });

cli
  .command("start", "Start the production server")
  .action(async (cliOptions: PonderCliOptions) => {
    if (cliOptions.help) process.exit(0);

    const options = buildOptions({ ...cliOptions, logType: "start" });
    const config = await buildPonderConfig(options);
    const ponder = new Ponder({ options, config });
    registerKilledProcessListener(() => ponder.kill());
    await ponder.start();
  });

cli
  .command("codegen", "Emit type files, then exit")
  .action(async (cliOptions: PonderCliOptions) => {
    if (cliOptions.help) process.exit(0);

    const options = buildOptions({ ...cliOptions, logType: "codegen" });
    const config = await buildPonderConfig(options);
    const ponder = new Ponder({ options, config });
    registerKilledProcessListener(() => ponder.kill());
    await ponder.codegen();
  });

cli.parse();
