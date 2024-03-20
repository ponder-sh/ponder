#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cac } from "cac";
import { codegen } from "./codegen.js";
import { dev } from "./dev.js";
import { serve } from "./serve.js";
import { start } from "./start.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(__dirname, "../../package.json");
const packageJson = JSON.parse(
  readFileSync(packageJsonPath, { encoding: "utf8" }),
);

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

    await dev({ cliOptions });
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

    await start({ cliOptions });
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

    await serve({ cliOptions });
  });

cli
  .command("codegen", "Generate the schema.graphql file, then exit")
  .action(async (cliOptions: CliOptions) => {
    if (cliOptions.help) process.exit(0);

    await codegen({ cliOptions });
  });

cli.parse();
