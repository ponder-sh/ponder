import { readFileSync } from "node:fs";
import { start } from "../../packages/core/src/bin/commands/start.js";

/**
 * Run `ponder start` from the core source, for `live.ts`.
 *
 * Logs are JSON lines on stdout.
 *
 * Usage: `bun run src/live-ponder.ts [root] [schema] [port] [log level]`
 */
const [root, schema, port, logLevel] = process.argv.slice(2);

const packageJson = JSON.parse(
  readFileSync(
    new URL("../../packages/core/package.json", import.meta.url),
    "utf8",
  ),
) as { version: string };

start({
  cliOptions: {
    command: "start",
    version: packageJson.version,
    root: root!,
    config: "ponder.config.ts",
    schema,
    port: Number(port),
    logLevel,
    logFormat: "json",
  },
});
