import path from "node:path";
import {
  Cause,
  Clock,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Random,
  References,
  Scheduler,
  Scope,
} from "effect";
import { buildApp, runApp } from "@/bin/commands/start.js";
import { isBuildFailed } from "@/bin/utils/command.js";
import { Db, makeDb, makeDbTransports } from "@/database/db.js";
import { ExternalIo } from "@/internal/io.js";
import { createLogger, type LogLevel } from "@/internal/logger.js";
import { Metrics, MetricsService } from "@/internal/metrics.js";
import { buildOptions, Options } from "@/internal/options.js";
import { createRpc } from "@/rpc/index.js";
import packageJson from "../../packages/core/package.json" with {
  type: "json",
};
import { writeApp } from "./app.js";
import { SimChain } from "./chain.js";
import { checkDatabase, makeLivenessCheck } from "./check.js";
import { makeSimClock } from "./clock.js";
import { type DbStats, makeDbGate, makeSimDb } from "./db.js";
import type { AppPlan, Plan } from "./plan.js";
import { Rng } from "./random.js";
import { makeSimRpc, type RpcStats } from "./rpc.js";
import { makeSimScheduler } from "./scheduler.js";

export type WorldResult = {
  /** `undefined` if the simulation completed. */
  error: Error | undefined;
  virtualMs: number;
  wallMs: number;
  steps: number;
  /**
   * The virtual time (ms) from the start of each run of `plan.runs` until its
   * app was ready, or `undefined` if it never was.
   */
  runs: { app: string; readyMs: number | undefined }[];
  chains: { name: string; head: number; reorgs: number }[];
  rpc: { hostname: string; stats: RpcStats }[];
  db: DbStats;
  /** I/O released out of the seeded order, which a rerun may not repeat. */
  lockWaits: number;
};

/** The simulation ran into something that is not a Ponder failure. */
export class SimulationError extends Error {
  override name = "SimulationError";
}

/** Ponder failed. */
export class PonderFailure extends Error {
  override name = "PonderFailure";
}

const log = (msg: string, fields: Record<string, unknown> = {}) =>
  Effect.logDebug({ msg, service: "simulation", ...fields });

/**
 * Run the apps of `plan` against simulated chains and providers, with a
 * virtual clock and a seeded scheduler.
 */
export const runWorld = async ({
  plan,
  databaseUrl,
  appsDir,
  logLevel,
}: {
  plan: Plan;
  databaseUrl: string;
  appsDir: string;
  /** The log level of Ponder and the simulation. */
  logLevel: LogLevel;
}): Promise<WorldResult> => {
  const wallStart = performance.now();
  const endTime = plan.startTime + plan.duration;

  // Chains and providers

  const chains = plan.chains.map(
    (chainPlan) => new SimChain(chainPlan, plan.seed),
  );
  const providers = new Map(
    plan.chains.map((chainPlan, i) => [
      chainPlan.id,
      chainPlan.rpcs.map((rpcPlan, j) =>
        makeSimRpc({
          chain: chains[i]!,
          plan: rpcPlan,
          index: j,
          rng: new Rng(plan.seed, `rpc:${chainPlan.id}:${j}`),
          startTime: plan.startTime,
        }),
      ),
    ]),
  );

  // Apps

  const appDirs = plan.apps.map((app) => {
    const dir = path.join(appsDir, app.id);
    writeApp({ plan, app, dir, databaseUrl });
    return dir;
  });

  // Scheduler and clock

  const jumpRng = new Rng(plan.seed, "jumps");
  const scheduler = makeSimScheduler({
    random: new Rng(plan.seed, "scheduler"),
    jumpRate: plan.scheduler.jumpRate,
    jump: () => {
      const now = clock.currentTimeMillisUnsafe();
      const at = Math.max(
        clock.nextWakeup() ?? now,
        now + jumpRng.pick(plan.scheduler.jumps),
      );
      if (at > now) clock.advanceTo(at);
    },
  });
  const clock = makeSimClock(plan.startTime, scheduler.schedule);
  const gate = makeDbGate();
  const simDb = makeSimDb({ plan, scheduler, gate });

  // Readiness

  /** The virtual time the app of the current run was ready. */
  let readyAt: number | undefined;
  /** The app of the current run. */
  let currentApp: AppPlan | undefined;
  const liveness = makeLivenessCheck(plan);
  /**
   * Records when the app logs that `/ready` returns 200, and its indexed live
   * blocks for the liveness check. The date of a log is from the clock of its
   * fiber, the virtual clock.
   *
   * @dev Watching the log, instead of requesting `/ready`, adds no statements.
   */
  const readyLogger = Logger.make(({ message, date }) => {
    const [first] = message as [unknown];
    if (
      readyAt === undefined &&
      typeof first === "object" &&
      first !== null &&
      "msg" in first &&
      first.msg === "Started returning 200 responses" &&
      "endpoint" in first &&
      first.endpoint === "/ready"
    ) {
      readyAt = date.getTime();
      liveness.onReady(currentApp!, readyAt);
    }
    if (
      typeof first === "object" &&
      first !== null &&
      "msg" in first &&
      first.msg === "Indexed block" &&
      "chain" in first &&
      typeof first.chain === "string"
    ) {
      liveness.onIndexedBlock(first.chain, date.getTime());
    }
  });
  const runResults: WorldResult["runs"] = [];

  // The world

  /** Mine a block of `chain` at the time of its timestamp, until the end. */
  const mine = (chain: SimChain) =>
    Effect.gen(function* () {
      const rng = new Rng(plan.seed, `miner:${chain.plan.id}`);
      for (let n = chain.plan.historicalBlocks; chain.time(n) <= endTime; n++) {
        yield* sleepUntil(chain.time(n));
        const now = yield* Clock.currentTimeMillis;
        if (rng.bool(chain.plan.reorgRate)) {
          const depth = rng.int(1, chain.plan.maxReorgDepth);
          chain.reorg(depth, now);
          yield* log("Reorged simulated chain", {
            chain: chain.plan.name,
            depth,
          });
        }
        chain.mine(now);
      }
    });

  /**
   * Run `plan.runs[index]`: start its app, and stop it at `stopAt`. The app
   * exiting before then is a failure.
   */
  const runPlannedApp = (index: number) =>
    Effect.gen(function* () {
      const run = plan.runs[index]!;
      const app = plan.apps[run.app]!;
      const cliOptions = {
        command: "start" as const,
        version: packageJson.version,
        root: appDirs[run.app]!,
        config: "ponder.config.ts",
        schema: app.id,
        logLevel,
        logFormat: "pretty",
        port: 40_000 + new Rng(plan.seed, "port").int(0, 20_000),
      };

      const options = buildOptions({ cliOptions });

      /**
       * Like `startApp`, with the database transports wrapped by the
       * simulated database, and the simulated providers of each chain.
       */
      const start = Effect.gen(function* () {
        const build = yield* buildApp({ cliOptions });
        const transports = yield* makeDbTransports({
          namespace: build.namespaceBuild,
          preBuild: build.preBuild,
          schemaBuild: build.schemaBuild,
        });
        const db = yield* makeDb(simDb.wrap(transports));
        const rpcs = yield* Effect.forEach(build.chains, (chain) => {
          const chainPlan = plan.chains.find((c) => c.id === chain.id)!;
          const chainProviders = providers.get(chain.id)!;
          return createRpc({
            chain,
            concurrency: Math.floor(
              options.rpcMaxConcurrency / build.chains.length,
            ),
            transports: chainProviders.map((p) => p.transport),
            subscribe: chainPlan.subscribe
              ? chainProviders[
                  new Rng(plan.seed, `ws:${chain.id}`).int(
                    0,
                    chainProviders.length - 1,
                  )
                ]!.connect
              : undefined,
          });
        });
        return yield* runApp({ ...build, rpcs }).pipe(
          Effect.provideService(Db, db),
        );
      }).pipe(
        Effect.catchIf(isBuildFailed, ({ code }) => Effect.succeed(code)),
      );

      yield* log("Started app", { run: index, app: app.id });
      const startedAt = yield* Clock.currentTimeMillis;
      readyAt = undefined;
      currentApp = app;
      const result: WorldResult["runs"][number] = {
        app: app.id,
        readyMs: undefined,
      };
      runResults.push(result);
      const scope = yield* Scope.make();
      const fiber = yield* Effect.forkDetach(
        start.pipe(
          Scope.provide(scope),
          Effect.provideService(Options, options),
          Effect.provideService(Metrics, new MetricsService()),
        ),
      );

      const exit = yield* Effect.raceFirst(
        Fiber.await(fiber),
        sleepUntil(plan.startTime + run.stopAt).pipe(Effect.as(undefined)),
      );
      if (readyAt !== undefined) result.readyMs = readyAt - startedAt;
      if (exit !== undefined) {
        return yield* Effect.fail(
          new PonderFailure(
            Exit.isSuccess(exit)
              ? `App exited with code ${exit.value}`
              : `App failed: ${Cause.pretty(exit.cause)}`,
          ),
        );
      }

      liveness.onStop(yield* Clock.currentTimeMillis);
      yield* log(run.stop === "kill" ? "Killed app" : "Stopped app", {
        run: index,
        app: app.id,
      });
      // Note: Like a killed process, the app doesn't run statements anymore.
      // Its schema stays locked until the heartbeat times out.
      if (run.stop === "kill") simDb.kill();
      yield* Fiber.interrupt(fiber);
      yield* Scope.close(scope, Exit.void);
      simDb.revive();
    });

  const world = Effect.gen(function* () {
    const miners = yield* Effect.forkChild(
      Effect.all(chains.map(mine), { concurrency: "unbounded" }),
    );
    for (let i = 0; i < plan.runs.length; i++) yield* runPlannedApp(i);
    yield* Fiber.interrupt(miners);
  });

  const services = Layer.mergeAll(
    Logger.layer([createLogger({ level: logLevel }), readyLogger]),
    // Note: The ready log is at `info`. The logger of Ponder drops logs under
    // `logLevel`.
    Layer.succeed(
      References.MinimumLogLevel,
      logLevel === "debug" ? "Debug" : logLevel === "trace" ? "Trace" : "Info",
    ),
    Layer.succeed(Clock.Clock, clock),
    Layer.succeed(Scheduler.Scheduler, scheduler),
    Layer.succeed(Random.Random, new Rng(plan.seed, "ponder").toRandom()),
    Layer.succeed(ExternalIo, { run: (effect) => scheduler.io(effect) }),
  );

  // The step loop: run every fiber that can run, then move the clock to the
  // next sleep, until the world exits.
  let exit: Exit.Exit<void, unknown> | undefined;
  const fiber = Effect.runFork(Effect.provide(world, services), { scheduler });
  fiber.addObserver((e) => {
    exit = e;
  });

  let error: Error | undefined;
  while (exit === undefined) {
    await scheduler.runUntilIdle();
    const next = clock.nextWakeup();
    if (next !== undefined) clock.advanceTo(next);
    // Note: I/O that waits on a lock finishes later.
    else if (exit === undefined && scheduler.inFlight() === 0) {
      error = new SimulationError(
        "Deadlock: no fiber can run and no sleep is pending",
      );
      break;
    }
  }

  if (exit !== undefined && Exit.isFailure(exit)) {
    const cause = Cause.squash(exit.cause);
    error = cause instanceof Error ? cause : new Error(String(cause));
  }

  // Note: A rerun of the seed may not repeat the run, including a failure of
  // Ponder.
  const lockWaits = scheduler.lockWaits() + gate.lockWaits();
  if (error === undefined && lockWaits > 0) {
    error = new SimulationError(
      `Nondeterministic: ${lockWaits} I/O waited on wall-clock time instead of the seeded order`,
    );
  }

  if (error === undefined && liveness.violation !== undefined) {
    error = new PonderFailure(liveness.violation);
  }

  if (error === undefined) {
    const violation = await checkDatabase({ plan, chains, databaseUrl });
    if (violation !== undefined) error = new PonderFailure(violation);
  }

  return {
    error,
    virtualMs: clock.currentTimeMillisUnsafe() - plan.startTime,
    wallMs: performance.now() - wallStart,
    steps: scheduler.steps(),
    runs: runResults,
    chains: chains.map((c) => ({
      name: c.plan.name,
      head: c.head.number,
      reorgs: c.reorgCount,
    })),
    rpc: [...providers.values()].flat().map((rpc) => ({
      hostname: rpc.hostname,
      stats: rpc.stats,
    })),
    db: simDb.stats,
    lockWaits,
  };
};

const sleepUntil = (at: number) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    at > now ? Effect.sleep(at - now) : Effect.void,
  );
