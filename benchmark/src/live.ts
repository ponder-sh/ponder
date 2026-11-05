import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { writeApp } from "../../simulation-test/src/app.js";
import type { Plan } from "../../simulation-test/src/plan.js";
import { serveChains } from "../../simulation-test/src/serve.js";

/**
 * Live indexing: serve the chain of a plan in real time, run Ponder against
 * it, and print how far Ponder is from the tip, from its logs, until stopped.
 * Ponder keeps up if the lag stays flat.
 *
 * Change the block rate (`blockTime`), the transactions per block
 * (`activity`), or anything else in the plan file.
 *
 * Usage: `bun run live [plan file]`
 */
const planFile =
  process.argv[2] ??
  path.join(import.meta.dirname, "../../simulation-test/plans/live.json");
const plan = JSON.parse(fs.readFileSync(planFile, "utf8")) as Plan;
const app = plan.apps[0]!;
const chainPlan = plan.chains[0]!;

/** Seconds between lines of output. */
const INTERVAL = 5_000;

const PONDER_PORT = Number(process.env.PORT ?? 42069);
const RPC_PORT = PONDER_PORT + 1;
const DATABASE = "benchmark_live";
const serverUrl = process.env.DATABASE_URL!.replace(/\/$/, "");
const appDir = path.join(import.meta.dirname, "..", ".apps", "live");

const admin = new pg.Client({
  connectionString: `${serverUrl}/${process.env.PGDATABASE ?? "postgres"}`,
});
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${DATABASE}"`);
await admin.end();

const served = serveChains({ plan, port: RPC_PORT });
writeApp({
  plan,
  app,
  dir: appDir,
  databaseUrl: `${serverUrl}/${DATABASE}`,
  rpcUrls: served.urls,
});

const ponder = Bun.spawn(
  [
    "bun",
    "run",
    path.join(import.meta.dirname, "live-ponder.ts"),
    appDir,
    app.id,
    String(PONDER_PORT),
    "info",
  ],
  {
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, PONDER_TELEMETRY_DISABLED: "true" },
  },
);

let stopping = false;
const stop = async (code: number) => {
  stopping = true;
  ponder.kill("SIGINT");
  await ponder.exited;
  served.stop();
  process.exit(code);
};
process.on("SIGINT", () => stop(0));
ponder.exited.then((code) => {
  if (stopping) return;
  console.error(`[live] Ponder exited with code ${code}`);
  served.stop();
  process.exit(1);
});

const average = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
console.log(
  `[live] ${planFile}: ${1 / chainPlan.blockTime} blocks/s, ${average(chainPlan.activity)} transactions/block, polling_interval=${chainPlan.pollingInterval}ms`,
);

// Indexed blocks, from the logs of Ponder

/** Pino log levels at or above `warn`. */
const WARN = 40;
type Log = {
  level: number;
  msg: string;
  number?: number;
  event_count?: number;
  duration?: number;
};

let ready = false;
/** The latest block that Ponder indexed. */
let indexed: number | undefined;
/** Indexed blocks, events, and indexing ms, since the last line of output. */
let window = { blocks: 0, events: 0, duration: 0 };

const onLog = (log: Log) => {
  if (log.msg === "Indexed block") {
    indexed = log.number;
    window.blocks++;
    window.events += log.event_count ?? 0;
    window.duration += log.duration ?? 0;
  } else if (log.msg === "Started returning 200 responses") {
    ready ||= (log as { endpoint?: string }).endpoint === "/ready";
  }
  if (log.level >= WARN) console.error(JSON.stringify(log));
};

(async () => {
  let buffer = "";
  for await (const chunk of ponder.stdout.pipeThrough(
    new TextDecoderStream(),
  )) {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (line === "") continue;
      try {
        onLog(JSON.parse(line) as Log);
      } catch {
        console.log(line);
      }
    }
  }
})();

// Output

const chain = served.chains[0]!;
let previous = {
  t: performance.now(),
  head: chain.head.number,
  requests: served.requests(),
};
while (true) {
  await Bun.sleep(INTERVAL);
  const current = {
    t: performance.now(),
    head: chain.head.number,
    requests: served.requests(),
  };
  if (ready && indexed !== undefined) {
    const seconds = (current.t - previous.t) / 1_000;
    const { blocks, events, duration } = window;
    console.log(
      `[live] mined=${((current.head - previous.head) / seconds).toFixed(1)}/s indexed=${(blocks / seconds).toFixed(1)}/s lag=${current.head - indexed} blocks events=${(events / blocks).toFixed(1)}/block indexing=${(duration / blocks).toFixed(2)}ms/block requests=${((current.requests - previous.requests) / blocks).toFixed(2)}/block`,
    );
  } else {
    console.log("[live] waiting for Ponder to be ready");
  }
  window = { blocks: 0, events: 0, duration: 0 };
  previous = current;
}
