import path from "node:path";
import { writeApp } from "../../simulation-test/src/app.js";
import { getUrls } from "../../simulation-test/src/serve.js";
import {
  log,
  readPlan,
  resetDatabase,
  runPonder,
  startChainServer,
} from "./harness.js";

/**
 * Live indexing: serve the chain of a plan in real time, run Ponder against
 * it, and print how far Ponder is from the tip until stopped. Ponder keeps up
 * if the lag stays flat.
 *
 * Change the block rate (`blockTime`), the transactions per block
 * (`activity`), or anything else in the plan file.
 *
 * Usage: `bun run live [plan file]`
 */
const planFile =
  process.argv[2] ??
  path.join(import.meta.dirname, "../../simulation-test/plans/live.json");
const plan = readPlan(planFile);
const app = plan.apps[0]!;
const chainPlan = plan.chains[0]!;

/** Milliseconds between lines of output. */
const INTERVAL = 5_000;

const PONDER_PORT = 42069;
const RPC_PORT = PONDER_PORT + 1;
const DATABASE = "benchmark_live";
const serverUrl = process.env.DATABASE_URL!.replace(/\/$/, "");
const appDir = path.join(import.meta.dirname, "..", ".apps", "live");

process.env.PONDER_TELEMETRY_DISABLED = "true";

await resetDatabase(serverUrl, DATABASE);
const server = await startChainServer(planFile, RPC_PORT);
writeApp({
  plan,
  app,
  dir: appDir,
  databaseUrl: `${serverUrl}/${DATABASE}`,
  rpcUrls: getUrls(plan, RPC_PORT),
});

const average = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
log({
  msg: "Started chain server",
  plan: planFile,
  port: RPC_PORT,
  blocks_per_second: 1 / chainPlan.blockTime,
  transactions_per_block: average(chainPlan.activity),
});

/** The latest block that Ponder indexed. */
let indexed: number | undefined;
/** Indexed blocks, events, and indexing ms, since the last line of output. */
let window = { blocks: 0, events: 0, duration: 0 };

const ponder = runPonder({
  cliOptions: {
    root: appDir,
    schema: app.id,
    port: PONDER_PORT,
    logLevel: "info",
  },
  onLog: (log) => {
    if (log.msg !== "Indexed block") return;
    indexed = log.number as number;
    window.blocks++;
    window.events += log.event_count as number;
    window.duration += log.duration as number;
  },
});

let stopping = false;
process.on("SIGINT", async () => {
  stopping = true;
  await ponder.stop();
  server.stop();
  log({ msg: "Stopped benchmark" });
  process.exit(0);
});
ponder.exited.then((code) => {
  if (stopping) return;
  log({ msg: "Ponder exited", code }, "error");
  server.stop();
  process.exit(1);
});

await ponder.ready;

let previous = { t: performance.now(), ...(await server.stats()) };
window = { blocks: 0, events: 0, duration: 0 };
while (true) {
  await Bun.sleep(INTERVAL);
  const current = { t: performance.now(), ...(await server.stats()) };
  const seconds = (current.t - previous.t) / 1_000;
  const head = current.heads[chainPlan.name]!;
  const { blocks, events, duration } = window;
  /** `value` per indexed block, or `-` without one. */
  const perBlock = (value: number, digits: number) =>
    blocks === 0 ? "-" : (value / blocks).toFixed(digits);
  log({
    msg: "Measured live indexing",
    mined_per_second: (
      (head - previous.heads[chainPlan.name]!) /
      seconds
    ).toFixed(1),
    indexed_per_second: (blocks / seconds).toFixed(1),
    lag_blocks: head - (indexed ?? 0),
    events_per_block: perBlock(events, 1),
    indexing_ms_per_block: perBlock(duration, 2),
    requests_per_block: perBlock(current.requests - previous.requests, 2),
  });
  window = { blocks: 0, events: 0, duration: 0 };
  previous = current;
}
