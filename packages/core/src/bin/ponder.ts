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

/**
 * CLI options for `ponder` commands. Note that we don't always use CAC's built-in
 * default value behavior, because we want to know downstream if the user explicitly
 * set a value or not.
 */
export type CliOptions = {
  help?: boolean;
  root?: string;
  config: string;
  port?: number;
  hostname?: string;
  // CAC converts `-vv` to { v: [true, true], debug: [true, true] }
  v?: boolean | boolean[];
  debug?: boolean | boolean[];
  trace?: boolean;
};

const cli = cac("ponder")
  .version(packageJson.version)
  .usage("<command> [OPTIONS]")
  .option(
    "--root [PATH]",
    "Path to the project root directory (default: working directory)",
  )
  .option("--config [PATH]", "Path to the project config file", {
    default: "ponder.config.ts",
  })
  .help();

cli
  .command("dev", "Start the app in development mode")
  .option(
    "-p, --port [PORT]",
    "Port number for the the web server (default: 42069)",
  )
  .option(
    "-H, --hostname [HOSTNAME]",
    "Hostname for the web server (default: 0.0.0.0)",
  )
  .option(
    "-v, --debug",
    "Enable debug logs including realtime blocks, internal events, etc",
  )
  .option(
    "-vv, --trace",
    "Enable trace logs including db queries, indexing checkpoints, etc",
  )
  .action(async (cliOptions: CliOptions) => {
    if (cliOptions.help) process.exit(0);

    validateNodeVersion();

    const options = buildOptions({ cliOptions });
    const devOptions = { ...options, uiEnabled: true };

    const ponder = new Ponder({ options: devOptions });
    registerKilledProcessListener(() => ponder.kill());

    await ponder.dev();
  });

cli
  .command("start", "Start the app in production mode")
  .option(
    "-p, --port [PORT]",
    "Port number for the the web server (default: 42069)",
  )
  .option(
    "-H, --hostname [HOSTNAME]",
    "Hostname for the web server (default: 0.0.0.0)",
  )
  .option(
    "-v, --debug",
    "Enable debug logs including realtime blocks, internal events, etc",
  )
  .option(
    "-vv, --trace",
    "Enable trace logs including db queries, indexing checkpoints, etc",
  )
  .action(async (cliOptions: CliOptions) => {
    if (cliOptions.help) process.exit(0);

    validateNodeVersion();

    const options = buildOptions({ cliOptions });
    const startOptions = { ...options, uiEnabled: false };

    const ponder = new Ponder({ options: startOptions });
    registerKilledProcessListener(() => ponder.kill());

    await ponder.start();
  });

cli
  .command("serve", "Start the web server (experimental)")
  .option(
    "-p, --port [PORT]",
    "Port number for the the web server (default: 42069)",
  )
  .option(
    "-H, --hostname [HOSTNAME]",
    "Hostname for the web server (default: 0.0.0.0)",
  )
  .option(
    "-v, --debug",
    "Enable debug logs including realtime blocks, internal events, etc",
  )
  .option(
    "-vv, --trace",
    "Enable trace logs including db queries, indexing checkpoints, etc",
  )
  .action(async (cliOptions: CliOptions) => {
    if (cliOptions.help) process.exit(0);

    validateNodeVersion();

    const options = buildOptions({ cliOptions });
    const devOptions = { ...options, uiEnabled: true };

    const ponder = new Ponder({ options: devOptions });
    registerKilledProcessListener(() => ponder.kill());

    await ponder.serve();
  });

cli
  .command("codegen", "Generate the schema.graphql file, then exit")
  .action(async (cliOptions: CliOptions) => {
    if (cliOptions.help) process.exit(0);

    validateNodeVersion();

    const options = buildOptions({ cliOptions });
    const codegenOptions = {
      ...options,
      uiEnabled: false,
      logLevel: "error" as const,
    };

    const ponder = new Ponder({ options: codegenOptions });
    registerKilledProcessListener(() => ponder.kill());

    await ponder.codegen();
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

/**
 * Checks the user's node version at run time. Used in combinatatin with
 * package.json "engine" field to ensure proper use.
 */
function validateNodeVersion() {
  const _nodeVersion = process.version.split(".");
  const nodeVersion = [
    Number(_nodeVersion[0].slice(1)),
    Number(_nodeVersion[1]),
    Number(_nodeVersion[2]),
  ];
  if (nodeVersion[0] < 18 || (nodeVersion[0] === 18 && nodeVersion[1] < 14)) {
    console.log(
      `Ponder requires ${pc.cyan("Node >=18")}, detected ${process.version}.`,
    );
    console.log("");
    process.exit(1);
  }
}
