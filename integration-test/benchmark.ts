import { Command } from "commander";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { start } from "../packages/core/src/bin/commands/start.js";

let db = drizzle(process.env.DATABASE_URL!, { casing: "snake_case" });

// inputs

const APP_ID = process.argv[2];
const APP_DIR = `./apps/${APP_ID}`;
const UUID = process.env.UUID ?? crypto.randomUUID();

if (APP_ID === undefined) {
  throw new Error("App ID is required. Example: 'pnpm benchmark [app id]'");
}

// 1. Create database
await db.execute(sql.raw(`CREATE DATABASE "${UUID}" TEMPLATE "${APP_ID}"`));

db = drizzle(`${process.env.DATABASE_URL!}/${UUID}`, {
  casing: "snake_case",
});

// 2. Copy expected data

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

process.env.DATABASE_SCHEMA = "public";
process.env.DATABASE_URL = `${process.env.DATABASE_URL!}/${UUID}`;
process.env.PONDER_TELEMETRY_DISABLED = "true";

const t = performance.now();

const kill = await start({
  cliOptions: {
    ...program.optsWithGlobals(),
    command: "start",
    version: "0.0.0",
    root: APP_DIR,
    config: "ponder.config.ts",
  },
});

while (true) {
  try {
    const result = await fetch("http://localhost:42069/ready");
    if (result.status === 200) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 100));
}

console.log(`Completed in ${performance.now() - t}ms`);

await kill!();

process.exit(0);
