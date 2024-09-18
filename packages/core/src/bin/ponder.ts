#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Prettify } from "@/types/utils.js";
import { Command } from "@commander-js/extra-typings";
import dotenv from "dotenv";
import { codegen } from "./commands/codegen.js";
import { dev } from "./commands/dev.js";
import { serve } from "./commands/serve.js";
import { start } from "./commands/start.js";

dotenv.config({ path: ".env.local" });

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(__dirname, "../../package.json");
const packageJson = JSON.parse(
  readFileSync(packageJsonPath, { encoding: "utf8" }),
);

const ponder = new Command("ponder")
  .usage("<command> [OPTIONS]")
  .helpOption("-h, --help", "Show this help message")
  .helpCommand(false)
  .option(
    "--root <PATH>",
    "Path to the project root directory (default: working directory)",
  )
  .option(
    "--config <PATH>",
    "Path to the project config file",
    "ponder.config.ts",
  )
  .option(
    "-v, --debug",
    "Enable debug logs, e.g. realtime blocks, internal events",
  )
  .option(
    "-vv, --trace",
    "Enable trace logs, e.g. db queries, indexing checkpoints",
  )
  .option(
    "--log-level <LEVEL>",
    'Minimum log level ("error", "warn", "info", "debug", or "trace", default: "info")',
  )
  .option(
    "--log-format <FORMAT>",
    'The log format ("pretty" or "json")',
    "pretty",
  )
  .version(packageJson.version, "-V, --version", "Show the version number")
  .configureHelp({ showGlobalOptions: true })
  .allowExcessArguments(false)
  .showHelpAfterError()
  .enablePositionalOptions(false);

type GlobalOptions = {
  command: "dev" | "start" | "serve" | "codegen";
} & ReturnType<typeof ponder.opts>;

const devCommand = new Command("dev")
  .description("Start the development server with hot reloading")
  .option("-p, --port <PORT>", "Port for the web server", Number, 42069)
  // NOTE: Do not set a default for hostname. We currently rely on the Node.js
  // default behavior when passing undefined to http.Server.listen(), which
  // detects the available interfaces (IPv4 and/or IPv6) and uses them.
  // Documentation: https://arc.net/l/quote/dnjmtumq
  .option(
    "-H, --hostname <HOSTNAME>",
    'Hostname for the web server (default: "0.0.0.0" or "::")',
  )
  .showHelpAfterError()
  .action(async (_, command) => {
    const cliOptions = {
      ...command.optsWithGlobals(),
      command: command.name(),
    } as GlobalOptions & ReturnType<typeof command.opts>;
    await dev({ cliOptions });
  });

const startCommand = new Command("start")
  .description("Start the production server")
  .option("-p, --port <PORT>", "Port for the web server", Number, 42069)
  .option(
    "-H, --hostname <HOSTNAME>",
    'Hostname for the web server (default: "0.0.0.0" or "::")',
  )
  .showHelpAfterError()
  .action(async (_, command) => {
    const cliOptions = {
      ...command.optsWithGlobals(),
      command: command.name(),
    } as GlobalOptions & ReturnType<typeof command.opts>;
    await start({ cliOptions });
  });

const serveCommand = new Command("serve")
  .description("Start the production HTTP server without the indexer")
  .option("-p, --port <PORT>", "Port for the web server", Number, 42069)
  .option(
    "-H, --hostname <HOSTNAME>",
    'Hostname for the web server (default: "0.0.0.0" or "::")',
  )
  .showHelpAfterError()
  .action(async (_, command) => {
    const cliOptions = {
      ...command.optsWithGlobals(),
      command: command.name(),
    } as GlobalOptions & ReturnType<typeof command.opts>;
    await serve({ cliOptions });
  });

const codegenCommand = new Command("codegen")
  .description("Generate the schema.graphql file, then exit")
  .showHelpAfterError()
  .action(async (_, command) => {
    const cliOptions = {
      ...command.optsWithGlobals(),
      command: command.name(),
    } as GlobalOptions & ReturnType<typeof command.opts>;
    await codegen({ cliOptions });
  });

// const cache = new Command("cache");

// cache
//   .command("drop")
//   .description("Dangerously drop all cached RPC data")
//   .action(async (_, command) => {
//     const cliOptions = command.optsWithGlobals() as GlobalOptions &
//       ReturnType<typeof command.opts>;
//     console.log("ponder db drop");
//   });

// ponder.addCommand(cache);

// cli
//   .command("cache prune", "Drop stale indexed data tables")
//   .action(async (cliOptions: DbOptions) => {
//     // if (cliOptions.help) process.exit(0);
//     console.log("ponder cache prune");
//   });

ponder.addCommand(devCommand);
ponder.addCommand(startCommand);
ponder.addCommand(serveCommand);
ponder.addCommand(codegenCommand);

export type CliOptions = Prettify<
  GlobalOptions &
    Partial<
      ReturnType<typeof devCommand.opts> &
        ReturnType<typeof startCommand.opts> &
        ReturnType<typeof serveCommand.opts> &
        ReturnType<typeof codegenCommand.opts>
    >
>;

await ponder.parseAsync();
