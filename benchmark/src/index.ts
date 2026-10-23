import { readFileSync } from "node:fs";
import { Command } from "commander";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
// Import the built package so the runner works under Node (no `@/` alias
// resolution) and Bun alike. Run `pnpm build` after changing `packages/core`.
import { start } from "../../packages/core/dist/esm/bin/commands/start.js";
import {
  createMemoryMonitor,
  formatReading,
  heapLimitMiB,
  type MemoryReading,
  peakRssMiB,
  runtime,
  summarize,
} from "./memory.ts";

const packageJson = JSON.parse(
  readFileSync(
    new URL("../../packages/core/package.json", import.meta.url),
    "utf8",
  ),
) as { version: string };

/**
 * Apps that start at the chain tip. They need no pre-populated `ponder_sync`
 * cache, so the runner creates their database when it is missing, and they
 * run a live phase by default.
 */
const LIVE_APPS: Record<string, { liveDurationSeconds: number }> = {
  weth: { liveDurationSeconds: 600 },
};

const program = new Command()
  .argument("<app id>", "Directory name under ./apps")
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
  .option(
    "-p, --port <PORT>",
    "Port for the Ponder server (default: $PORT or 42069)",
  )
  .option(
    "--live-duration <SECONDS>",
    "Seconds to keep indexing live after /ready (default: $LIVE_DURATION, 600 for live apps, 0 otherwise)",
  )
  .option(
    "--sample-interval <SECONDS>",
    "Seconds between non-GC memory samples used for peaks",
    "5",
  )
  .option(
    "--gc-interval <SECONDS>",
    "Seconds between post-GC memory readings during the live phase",
    "30",
  )
  .parse(process.argv);

const opts = program.opts();
const APP_ID = program.args[0]!;
const APP_DIR = `./apps/${APP_ID}`;
const BASE_DATABASE_URL = process.env.DATABASE_URL!;
const DATABASE_URL = `${BASE_DATABASE_URL}/benchmark_${APP_ID}`;
const SCHEMA = "benchmark";
const PORT = Number(opts.port ?? process.env.PORT ?? 42069);
const LIVE_DURATION_MS =
  Number(
    opts.liveDuration ??
      process.env.LIVE_DURATION ??
      LIVE_APPS[APP_ID]?.liveDurationSeconds ??
      0,
  ) * 1000;
const SAMPLE_INTERVAL_MS = Number(opts.sampleInterval) * 1000;
const GC_INTERVAL_MS = Number(opts.gcInterval) * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (LIVE_APPS[APP_ID]) {
  const admin = drizzle(BASE_DATABASE_URL);
  const result = await admin.execute(
    sql`SELECT 1 FROM pg_database WHERE datname = ${`benchmark_${APP_ID}`}`,
  );
  if (result.rows.length === 0) {
    await admin.execute(sql.raw(`CREATE DATABASE "benchmark_${APP_ID}"`));
  }
  await admin.$client.end();
}

const db = drizzle(DATABASE_URL, { casing: "snake_case" });
await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`));
await db.$client.end();

process.env.PONDER_TELEMETRY_DISABLED = "true";
process.env.DATABASE_URL = DATABASE_URL;
process.env.DATABASE_SCHEMA = SCHEMA;
// Ponder prefers `PORT` over the CLI option.
process.env.PORT = String(PORT);

const memory = createMemoryMonitor({ sampleIntervalMs: SAMPLE_INTERVAL_MS });

const startTimestamp = performance.now();

const kill = await start({
  cliOptions: {
    debug: opts.debug,
    trace: opts.trace,
    logLevel: opts.logLevel,
    logFormat: opts.logFormat,
    port: PORT,
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
  await sleep(50);
}

const endTimestamp = performance.now();
const readyMs = Math.round(endTimestamp - startTimestamp);

console.log(`${APP_ID} took ${readyMs}ms`);

const peakRssAtReady = peakRssMiB();
const readyReading = memory.readAfterGc();
console.log(formatReading("ready", readyReading));

/** Sum of `ponder_indexing_completed_events` across all events. */
const completedEvents = async () => {
  try {
    const text = await (await fetch(`http://localhost:${PORT}/metrics`)).text();
    let total = 0;
    for (const line of text.split("\n")) {
      if (line.startsWith("ponder_indexing_completed_events{")) {
        total += Number(line.slice(line.lastIndexOf(" ") + 1));
      }
    }
    return total;
  } catch {
    return undefined;
  }
};

let live: Record<string, unknown> | undefined;

if (LIVE_DURATION_MS > 0) {
  const eventsAtReady = await completedEvents();
  // The ready reading still carries startup allocations, so live statistics
  // and the slope only use readings taken during the live phase.
  const liveReadings: MemoryReading[] = [];
  const liveStart = performance.now();

  while (performance.now() - liveStart < LIVE_DURATION_MS) {
    await sleep(
      Math.min(
        GC_INTERVAL_MS,
        LIVE_DURATION_MS - (performance.now() - liveStart),
      ),
    );
    const reading = memory.readAfterGc();
    liveReadings.push(reading);
    console.log(formatReading("live", reading));
  }

  const eventsAtEnd = await completedEvents();

  live = {
    durationS: Math.round((performance.now() - liveStart) / 1000),
    readings: liveReadings.length,
    events:
      eventsAtReady === undefined || eventsAtEnd === undefined
        ? null
        : eventsAtEnd - eventsAtReady,
    heapUsedMiB: summarize(liveReadings, "heapUsed"),
    rssMiB: summarize(liveReadings, "rss"),
  };
}

memory.stop();

console.log(
  `[summary] ${JSON.stringify({
    app: APP_ID,
    mode: LIVE_DURATION_MS > 0 ? "live" : "backfill",
    runtime: `${runtime.name}@${runtime.version}`,
    readyMs,
    heapLimitMiB,
    peakRssMiB: peakRssMiB(),
    peakRssAtReadyMiB: peakRssAtReady,
    readyAfterGcMiB: {
      rss: readyReading.rss,
      heapUsed: readyReading.heapUsed,
      heapTotal: readyReading.heapTotal,
      external: readyReading.external,
      arrayBuffers: readyReading.arrayBuffers,
    },
    peakSampleMiB: memory.peak(),
    live,
  })}`,
);

console.log("Killing app");

await kill!();

process.exit(0);
