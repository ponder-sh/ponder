import { Cause, Effect, Exit, Fiber, type Scope } from "effect";
import { runCodegen } from "@/bin/utils/codegen.js";
import { createBuild } from "@/build/index.js";
import { Db, makeDb } from "@/database/db.js";
import { migrate, migrateSync } from "@/database/migrate.js";
import { Metrics } from "@/internal/metrics.js";
import { buildOptions, type Options } from "@/internal/options.js";
import type {
  ApiBuild,
  CrashRecoveryCheckpoint,
  IndexingBuild,
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
} from "@/internal/types.js";
import { runMultichain } from "@/runtime/multichain.js";
import { runOmnichain } from "@/runtime/omnichain.js";
import { makeServer } from "@/server/index.js";
import { isolatedController } from "../isolatedController.js";
import type { CliOptions } from "../ponder.js";
import {
  checkNodeVersion,
  failBuild,
  isBuildFailed,
  setVersionInfo,
} from "../utils/command.js";
import { getExitCode, runMain } from "../utils/exit.js";

export type PonderApp = {
  preBuild: PreBuild;
  namespaceBuild: NamespaceBuild;
  schemaBuild: SchemaBuild;
  indexingBuild: IndexingBuild;
  apiBuild: ApiBuild;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
};

export function start({ cliOptions }: { cliOptions: CliOptions }) {
  const options = buildOptions({ cliOptions });

  runMain({ options, program: startApp({ cliOptions }) });
}

/**
 * Build the app, then run the indexer and the HTTP server until the scope
 * closes.
 *
 * @param onBuild - Replace the app after the build, before it runs.
 * @returns The exit code, when the build or the indexer fails.
 */
export const startApp = ({
  cliOptions,
  onBuild,
}: {
  cliOptions: CliOptions;
  onBuild?: (app: PonderApp) => Effect.Effect<PonderApp>;
}) =>
  Effect.gen(function* () {
    const metrics = yield* Metrics;

    yield* checkNodeVersion;
    yield* setVersionInfo;
    yield* runCodegen;

    const build = yield* createBuild({ cliOptions });

    const namespaceBuild = yield* build.namespaceCompile.pipe(
      failBuild("namespace"),
    );
    const configResult = yield* build.executeConfig.pipe(failBuild("config"));
    const schemaResult = yield* build.executeSchema.pipe(failBuild("schema"));
    const preBuild = yield* build
      .preCompile(configResult)
      .pipe(failBuild("pre-compile"));
    yield* build
      .databaseDiagnostic({ preBuild })
      .pipe(failBuild("diagnostic", 75));
    const schemaBuild = yield* build
      .compileSchema({ ...schemaResult, preBuild })
      .pipe(failBuild("schema"));
    const configBuild = yield* build
      .compileConfig({ configResult })
      .pipe(failBuild("config"));
    yield* build
      .rpcDiagnostic({ configBuild })
      .pipe(failBuild("diagnostic", 75));
    const indexingResult = yield* build.executeIndexingFunctions.pipe(
      failBuild("indexing"),
    );
    const indexingBuild = yield* build
      .compileIndexing({
        configResult,
        schemaResult,
        indexingResult,
        configBuild,
      })
      .pipe(failBuild("indexing"));

    const db = yield* makeDb({
      namespace: namespaceBuild,
      preBuild,
      schemaBuild,
    });

    return yield* Effect.gen(function* () {
      const crashRecoveryCheckpoint = yield* migrate({
        namespace: namespaceBuild,
        preBuild,
        schemaBuild,
        buildId: indexingBuild.buildId,
        chains: indexingBuild.chains,
        rpcs: indexingBuild.rpcs,
        finalizedBlocks: indexingBuild.finalizedBlocks,
      });

      yield* migrateSync;

      const apiResult = yield* build
        .executeApi({ preBuild, configBuild })
        .pipe(failBuild("api"));
      const apiBuild = yield* build
        .compileApi({ apiResult })
        .pipe(failBuild("api"));

      metrics.ponder_settings_info.set(
        {
          ordering: preBuild.ordering,
          database: preBuild.databaseConfig.kind,
          command: cliOptions.command,
        },
        1,
      );

      let app: PonderApp = {
        preBuild,
        namespaceBuild,
        schemaBuild,
        indexingBuild,
        apiBuild,
        crashRecoveryCheckpoint,
      };

      if (onBuild) {
        app = yield* onBuild(app);
      }

      metrics.initializeIndexingMetrics(app);

      const indexing = yield* Effect.forkScoped(runIndexing(app), {
        startImmediately: true,
      });

      yield* makeServer(app.apiBuild);

      // Note: The HTTP server keeps running after the indexer completes.
      const result = yield* Fiber.await(indexing);
      if (Exit.isSuccess(result)) return yield* Effect.never;

      const error = Cause.squash(result.cause);
      yield* Effect.logError({ msg: "unhandledRejection", error });
      return getExitCode(error);
    }).pipe(Effect.provideService(Db, db));
  }).pipe(Effect.catchIf(isBuildFailed, ({ code }) => Effect.succeed(code)));

/**
 * Run the indexer with the ordering of the app.
 */
export const runIndexing = (
  app: PonderApp,
): Effect.Effect<void, Error, Db | Metrics | Options | Scope.Scope> => {
  switch (app.preBuild.ordering) {
    case "omnichain":
      return runOmnichain(app);
    case "multichain":
      return runMultichain(app);
    case "experimental_isolated":
      return isolatedController(app);
  }
};
