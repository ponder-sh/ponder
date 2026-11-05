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
 * Uncached backfill: serve the chain of a plan in real time, with the
 * latency and limits of its providers, and time Ponder from a new database
 * until `/ready` returns 200.
 *
 * Change the number of blocks (`historicalBlocks`), the transactions per
 * block (`activity`), the providers (`rpcs`), or anything else in the plan
 * file.
 *
 * Usage: `bun run backfill [plan file]`
 */
const planFile =
  process.argv[2] ??
  path.join(import.meta.dirname, "../../simulation-test/plans/backfill.json");
const plan = readPlan(planFile);
const app = plan.apps[0]!;

const PONDER_PORT = 42069;
const RPC_PORT = PONDER_PORT + 1;
const DATABASE = "benchmark_backfill";
const serverUrl = process.env.DATABASE_URL!.replace(/\/$/, "");
const appDir = path.join(import.meta.dirname, "..", ".apps", "backfill");

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

log({
  msg: "Started chain server",
  plan: planFile,
  port: RPC_PORT,
  blocks: plan.chains.reduce((sum, chain) => sum + chain.historicalBlocks, 0),
});

const startTimestamp = Date.now();
const ponder = runPonder({
  cliOptions: {
    root: appDir,
    schema: app.id,
    port: PONDER_PORT,
    logLevel: "info",
  },
});

try {
  const endTimestamp = await ponder.ready;
  const { requests } = await server.stats();
  log({
    msg: "Completed backfill",
    requests,
    duration_ms: endTimestamp - startTimestamp,
  });
  await ponder.stop();
} finally {
  server.stop();
}
process.exit(0);
