import os from "node:os";
import readline from "node:readline";
import { Cause, Effect, Exit, Fiber, Layer, Option, Scope } from "effect";
import { NonRetryableUserError, ShutdownError } from "@/internal/errors.js";
import { type LogLevel, layerLogger } from "@/internal/logger.js";
import { Metrics, MetricsService } from "@/internal/metrics.js";
import { Options } from "@/internal/options.js";

const SHUTDOWN_GRACE_PERIOD_MS = 5_000;

/** The exit code for an error that stops the app. */
export const getExitCode = (error: unknown) =>
  error instanceof NonRetryableUserError ? 1 : 75;

/**
 * Run the program of a command as the process, and exit with the code that
 * the program returns.
 *
 * The shutdown sequence starts when the program returns or fails, or the
 * process receives SIGINT, SIGTERM, or SIGQUIT. It interrupts the program and
 * closes its scope, with a grace period of 5 seconds. It logs `Started
 * shutdown sequence`, except after a program that completes with code 0.
 *
 * @dev A failed program is logged as `uncaughtException`, like an error that
 * a command threw before.
 */
export const runMain = ({
  options,
  logLevel = options.logLevel,
  program,
}: {
  options: Options["Service"];
  logLevel?: LogLevel;
  program: Effect.Effect<number, unknown, Options | Metrics | Scope.Scope>;
}) => {
  const services = Layer.mergeAll(
    Layer.succeed(Options, options),
    Layer.succeed(Metrics, new MetricsService()),
    layerLogger({ level: logLevel, mode: options.logFormat }),
  );
  // Note: The services outlive the scope of the program, so that the
  // shutdown sequence can log.
  const context = Effect.runSync(
    Layer.buildWithScope(services, Scope.makeUnsafe()),
  );
  const runFork = Effect.runForkWith(context);
  const logUnsafe = Effect.runSyncWith(context);

  const scope = Scope.makeUnsafe();
  const main = runFork(Scope.provide(program, scope));

  let isShuttingDown = false;

  const exit = (code: number, { isCompleted = false } = {}) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    runFork(
      Effect.gen(function* () {
        if (isCompleted === false) {
          yield* Effect.logWarning({ msg: "Started shutdown sequence" });
        }

        // Note: The shutdown runs in its own fiber, so that the grace period
        // can end it while a finalizer is still running.
        const shutdown = yield* Effect.forkDetach(
          Fiber.interrupt(main).pipe(
            Effect.andThen(Scope.close(scope, Exit.void)),
          ),
        );
        const result = yield* Fiber.await(shutdown).pipe(
          Effect.timeoutOption(SHUTDOWN_GRACE_PERIOD_MS),
        );

        if (Option.isNone(result)) {
          yield* Effect.logError({
            msg: "Failed to shutdown within 5 seconds",
            code,
          });
        } else if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
          process.stdin.pause();
        }

        process.exit(code);
      }),
    );
  };

  const onSignal = (signal: "SIGINT" | "SIGTERM" | "SIGQUIT") => {
    if (isShuttingDown) return;
    logUnsafe(Effect.logWarning({ msg: `Received ${signal}` }));
    exit(0);
  };

  if (os.platform() === "win32") {
    const readlineInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    readlineInterface.on("SIGINT", () => onSignal("SIGINT"));
  }

  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGQUIT", () => onSignal("SIGQUIT"));

  // Note: `ponder dev` handles these errors itself, so that a user error only
  // stops the app until the next hot reload.
  if (options.command !== "dev") {
    const onError =
      (msg: "uncaughtException" | "unhandledRejection") => (error: Error) => {
        if (error instanceof ShutdownError) return;
        logUnsafe(Effect.logError({ msg, error }));
        exit(getExitCode(error));
      };

    process.on("uncaughtException", onError("uncaughtException"));
    process.on("unhandledRejection", onError("unhandledRejection"));
  }

  main.addObserver((result) => {
    if (Exit.isSuccess(result)) {
      return exit(result.value, { isCompleted: result.value === 0 });
    }
    // Note: The shutdown sequence interrupts the program.
    if (isShuttingDown) return;

    const error = Cause.squash(result.cause);
    logUnsafe(Effect.logError({ msg: "uncaughtException", error }));
    exit(getExitCode(error));
  });
};
