import { Effect } from "effect";
import { satisfies } from "semver";
import { Metrics } from "@/internal/metrics.js";
import { Options } from "@/internal/options.js";

/**
 * Exit with code 1, without the shutdown sequence, if the Node.js version is
 * not supported.
 */
export const checkNodeVersion = Effect.gen(function* () {
  if (satisfies(process.versions.node, ">=22.12")) return;

  yield* Effect.logError({
    msg: "Invalid Node.js version",
    version: process.versions.node,
    expected: ">=22.12",
  });
  process.exit(1);
});

/** Set the `ponder_version_info` metric. */
export const setVersionInfo = Effect.gen(function* () {
  const options = yield* Options;
  const metrics = yield* Metrics;

  if (options.version) {
    metrics.ponder_version_info.set(
      {
        version: options.version.version,
        major: options.version.major,
        minor: options.version.minor,
        patch: options.version.patch,
      },
      1,
    );
  }
});

/** A build stage failed, and `Build failed` was logged. */
export class BuildFailed {
  constructor(
    readonly error: Error,
    readonly code: number,
  ) {}
}

export const isBuildFailed = (error: unknown): error is BuildFailed =>
  error instanceof BuildFailed;

/**
 * Log `Build failed` when the build stage fails, and fail with
 * {@link BuildFailed}.
 */
export const failBuild =
  (stage: string, code = 1) =>
  <A, R>(effect: Effect.Effect<A, Error, R>) =>
    effect.pipe(
      Effect.catch((error) =>
        Effect.andThen(
          Effect.logError({ msg: "Build failed", stage, error }),
          Effect.fail(new BuildFailed(error, code)),
        ),
      ),
    );
