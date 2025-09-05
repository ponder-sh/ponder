import crypto from "node:crypto";
import { Command } from "commander";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import packageJson from "../../packages/core/package.json" assert {
  type: "json",
};
import { start } from "../../packages/core/src/bin/commands/start.js";

const APP_ID = process.argv[2];
const APP_DIR = `./apps/${APP_ID}`;
const DATABASE_URL = `${process.env.DATABASE_URL!}/benchmark_${APP_ID}`;
const SCHEMA = "benchmark";
export const PORT = process.env.PORT ?? 42069;

export const DB = drizzle(DATABASE_URL!, { casing: "snake_case" });

await DB.execute(sql.raw(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`));

// TODO(kyle) metadata

const program = new Command()
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
  .parse(process.argv);

process.env.PONDER_TELEMETRY_DISABLED = "true";
process.env.DATABASE_URL = DATABASE_URL;
process.env.DATABASE_SCHEMA = "benchmark";

const startTimestamp = performance.now();

const kill = await start({
  cliOptions: {
    ...program.optsWithGlobals(),
    command: "start",
    version: packageJson.version,
    root: APP_DIR,
    config: "ponder.config.ts",
  },
});

while (true) {
  try {
    const result = await fetch(`http://localhost:${PORT}/ready`);
    if (result.status === 200) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const endTimestamp = performance.now();

console.log(`${APP_ID} took ${Math.round(endTimestamp - startTimestamp)}ms`);

console.log("Killing app");

await kill!();

process.exit(0);
