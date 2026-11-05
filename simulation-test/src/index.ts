import fs from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import pg from "pg";
import { type LogLevel, layerLogger } from "@/internal/logger.js";
import { makePlan, type Plan } from "./plan.js";
import { PonderFailure, runWorld } from "./world.js";

/**
 * Run one simulation.
 *
 * Usage: `SEED=<seed> bun run src/index.ts [--plan <file>]
 * [--log-level debug] [--print-plan]`
 *
 * Without `--plan`, the plan is generated at random from the seed.
 */
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : (args[i + 1] ?? "");
};

const planFile = flag("--plan");
const plan: Plan =
  planFile === undefined
    ? makePlan(process.env.SEED ?? crypto.randomUUID().slice(0, 8))
    : JSON.parse(fs.readFileSync(planFile, "utf8"));
const seed = plan.seed;
const logLevel = (flag("--log-level") ??
  process.env.LOG_LEVEL ??
  "warn") as LogLevel;

if (args.includes("--print-plan")) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

// Note: Ponder logs at `logLevel`. The summary of the simulation logs at
// `info`, or below if `logLevel` is lower.
const LEVELS: LogLevel[] = [
  "silent",
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
];
const summaryLevel =
  LEVELS.indexOf(logLevel) > LEVELS.indexOf("info") ? logLevel : "info";
const logger = layerLogger({ level: summaryLevel });
const log = (level: "info" | "error", fields: Record<string, unknown>) =>
  Effect.runSync(
    (level === "info" ? Effect.logInfo : Effect.logError)({
      service: "simulation",
      ...fields,
    }).pipe(Effect.provide(logger)),
  );

log("info", {
  msg: "Started simulation",
  plan: planFile ?? "random",
  seed,
  end: `${plan.duration / 1_000}s`,
  chains: plan.chains.map((c) => c.name).join(","),
  apps: plan.apps.map((a) => a.id).join(","),
  runs: plan.runs
    .map((r) => `${plan.apps[r.app]!.id}@${r.stopAt / 1_000}s:${r.stop}`)
    .join(","),
});

const appsDir = path.join(import.meta.dirname, "..", ".apps", seed);
fs.mkdirSync(appsDir, { recursive: true });

// Note: Each simulation has its own database. It is dropped when the
// simulation passes, and kept for inspection when it fails.
const serverUrl = (
  process.env.DATABASE_URL ?? "postgresql://postgres@localhost:5432"
).replace(/\/$/, "");
const database = `sim_${seed
  .replace(/[^a-z0-9]/gi, "_")
  .toLowerCase()
  .slice(0, 40)}`;
const admin = new pg.Client({ connectionString: `${serverUrl}/postgres` });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${database}"`);

const result = await runWorld({
  plan,
  databaseUrl: `${serverUrl}/${database}`,
  appsDir,
  logLevel,
});

log("info", {
  msg: "Completed simulation",
  virtual: `${(result.virtualMs / 1_000).toFixed(1)}s`,
  wall: `${(result.wallMs / 1_000).toFixed(1)}s`,
  steps: result.steps,
  lock_waits: result.lockWaits,
});
for (const [i, run] of result.runs.entries()) {
  log("info", {
    msg: "Simulated app run",
    run: i,
    app: run.app,
    ready:
      run.readyMs === undefined
        ? "never"
        : `${(run.readyMs / 1_000).toFixed(3)}s`,
  });
}
for (const chain of result.chains) {
  log("info", { msg: "Simulated chain", ...chain });
}
log("info", { msg: "Simulated database", ...result.db });
for (const { hostname, stats } of result.rpc) {
  log("info", { msg: "Simulated JSON-RPC provider", hostname, ...stats });
}

if (result.error) {
  log("error", {
    msg:
      result.error instanceof PonderFailure
        ? "Simulation failed"
        : "Simulation errored",
    database,
    reproduce:
      planFile === undefined
        ? `SEED=${seed} bun run test`
        : `bun run test --plan ${planFile}`,
    error: result.error,
  });
  await admin.end();
  process.exit(1);
}
await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
await admin.end();
log("info", { msg: "Simulation passed", seed });
process.exit(0);
