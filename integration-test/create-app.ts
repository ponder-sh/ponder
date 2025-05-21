import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { start } from "../packages/core/src/bin/commands/start.js";

let db = drizzle(process.env.CONNECTION_STRING!, { casing: "snake_case" });

// inputs

const APP_ID = process.argv[2];
const APP_DIR = `./apps/${APP_ID}`;

if (APP_ID === undefined) {
  throw new Error("App ID is required. Example: 'pnpm create:app [app id]'");
}

// 1. Create database
await db.execute(sql.raw(`CREATE DATABASE "${APP_ID}"`));

db = drizzle(`${process.env.CONNECTION_STRING!}/${APP_ID}`, {
  casing: "snake_case",
});

// 2. Create metadata schema

// 3. Copy expected data

process.env.DATABASE_SCHEMA = "expected";
process.env.DATABASE_URL = `${process.env.CONNECTION_STRING!}/${APP_ID}`;
process.env.PONDER_TELEMETRY_DISABLED = "true";

const kill = await start({
  cliOptions: {
    root: APP_DIR,
    command: "start",
    version: "0.0.0",
    config: "ponder.config.ts",
    logFormat: "pretty",
    // logLevel: "debug",
  },
});

while (true) {
  try {
    const result = await fetch("http://localhost:42069/ready");
    if (result.status === 200) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 100));
}

await kill!();
