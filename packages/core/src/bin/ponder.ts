#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cac } from "cac";
import dotenv from "dotenv";
import pc from "picocolors";

import { Ponder } from "@/Ponder.js";
import { buildOptions } from "@/config/options.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(__dirname, "../../package.json");
const packageJson = JSON.parse(
  readFileSync(packageJsonPath, { encoding: "utf8" }),
);

dotenv.config({ path: ".env.local" });

const cli = cac("ponder")
  .version(packageJson.version)
  .usage("<command> [options]")
  .help()
  .option("--config-file [path]", "Path to config file", {
    default: "ponder.config.ts",
  })
  .option("--root-dir [path]", "Path to project root directory", {
    default: ".",
  });

export type CliOptions = {
  help?: boolean;
  configFile: string;
  rootDir: string;
};

cli
  .command("dev", "Start the development server")
  .action(async (cliOptions: CliOptions) => {
    if (cliOptions.help) process.exit(0);

    validateNodeVersion();

    const options = buildOptions({ cliOptions });
    const devOptions = { ...options, uiEnabled: true };

    const ponder = new Ponder({ options: devOptions });
    registerKilledProcessListener(() => ponder.kill());

    const isSetupSuccessful = await ponder.setup();
    if (!isSetupSuccessful) return;
    await ponder.dev();
  });

cli
  .command("start", "Start the production indexing server")
  .action(async (cliOptions: CliOptions) => {
    if (cliOptions.help) process.exit(0);

    validateNodeVersion();

    const options = buildOptions({ cliOptions });
    const startOptions = { ...options, uiEnabled: false };

    const ponder = new Ponder({ options: startOptions });
    registerKilledProcessListener(() => ponder.kill());

    const isSetupSuccessful = await ponder.setup();
    if (!isSetupSuccessful) return;
    await ponder.start();
  });

cli
  .command("codegen", "Emit type files, then exit")
  .action(async (cliOptions: CliOptions) => {
    if (cliOptions.help) process.exit(0);

    validateNodeVersion();

    const options = buildOptions({ cliOptions });
    const codegenOptions = {
      ...options,
      uiEnabled: false,
      logLevel: "silent" as const,
    };

    const ponder = new Ponder({ options: codegenOptions });
    registerKilledProcessListener(() => ponder.kill());

    const isSetupSuccessful = await ponder.setup();
    if (!isSetupSuccessful) return;
    await ponder.codegen();
  });

cli
  .command("serve", "Start the web server")
  .action(async (cliOptions: CliOptions) => {
    if (cliOptions.help) process.exit(0);

    validateNodeVersion();

    const options = buildOptions({ cliOptions });
    const devOptions = { ...options, uiEnabled: true };

    const ponder = new Ponder({ options: devOptions });
    registerKilledProcessListener(() => ponder.kill());

    await ponder.serve();
  });

cli.parse();

function registerKilledProcessListener(fn: () => Promise<unknown>) {
  let isKillListenerInProgress = false;

  const listener = async () => {
    if (isKillListenerInProgress) return;
    isKillListenerInProgress = true;
    await fn();
    process.exit(0);
  };

  process.on("SIGINT", listener); // CTRL+C
  process.on("SIGQUIT", listener); // Keyboard quit
  process.on("SIGTERM", listener); // `kill` command
}

function validateNodeVersion() {
  if (Number(process.version.split(".")[0].slice(1)) < 18) {
    console.log(
      `Ponder requires ${pc.cyan("Node >=18")}, detected ${process.version}.`,
    );
    console.log("");
    process.exit(1);
  }
}
