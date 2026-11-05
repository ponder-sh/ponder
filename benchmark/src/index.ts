import { Command } from "commander";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { log, runPonder } from "./harness.js";

const APP_ID = process.argv[2];
const APP_DIR = `./apps/${APP_ID}`;
const DATABASE_URL = `${process.env.DATABASE_URL!}/benchmark_${APP_ID}`;
const SCHEMA = "benchmark";

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
process.env.DATABASE_SCHEMA = SCHEMA;

const startTimestamp = Date.now();
const ponder = runPonder({
  cliOptions: { ...program.optsWithGlobals(), root: APP_DIR },
});
const endTimestamp = await ponder.ready;

log({
  msg: "Completed benchmark",
  app: APP_ID,
  duration_ms: endTimestamp - startTimestamp,
});

await ponder.stop();
process.exit(0);
