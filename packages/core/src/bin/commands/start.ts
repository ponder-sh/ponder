import { Cause, Effect, Exit, Fiber } from "effect";
import { runCodegen } from "@/bin/utils/codegen.js";
import { createBuild } from "@/build/index.js";
import { Db, makeDb, makeDbTransports } from "@/database/db.js";
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
import { createRpcs, type Rpc } from "@/rpc/index.js";
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
 * Build the app, create its database and RPC clients, then run the indexer
 * and the HTTP server until the scope closes.
 *
 * @returns The exit code, when the build or the indexer fails.
 */
export const startApp = ({ cliOptions }: { cliOptions: CliOptions }) =>
  Effect.gen(function* () {
    const app = yield* buildApp({ cliOptions });
    const db = yield* makeDb(
      yield* makeDbTransports({
        namespace: app.namespaceBuild,
        preBuild: app.preBuild,
        schemaBuild: app.schemaBuild,
      }),
    );
    const rpcs = yield* createRpcs(app.chains).pipe(failBuild("config"));
    return yield* runApp({ ...app, rpcs }).pipe(Effect.provideService(Db, db));
  }).pipe(Effect.catchIf(isBuildFailed, ({ code }) => Effect.succeed(code)));

/**
 * Build the config and the schema of the app.
 *
 * @dev Fails with `BuildFailed`. The database and the RPC clients of the app
 * are created from the result, then passed to {@link runApp}.
 */
export const buildApp = ({ cliOptions }: { cliOptions: CliOptions }) =>
  Effect.gen(function* () {
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
    const schemaBuild = yield* build
      .compileSchema({ ...schemaResult, preBuild })
      .pipe(failBuild("schema"));
    const { chains } = yield* build
      .compileConfig({ configResult })
      .pipe(failBuild("config"));

    return {
      cliOptions,
      build,
      namespaceBuild,
      configResult,
      schemaResult,
      preBuild,
      schemaBuild,
      chains,
    };
  });

/**
 * Run the app with the database in `Db` and `rpcs`, the RPC client of each
 * chain: the indexer, and the HTTP server until the scope closes.
 *
 * @returns The exit code, when the indexer fails. Fails with `BuildFailed`.
 */
export const runApp = ({
  cliOptions,
  build,
  namespaceBuild,
  configResult,
  schemaResult,
  preBuild,
  schemaBuild,
  chains,
  rpcs,
}: Effect.Success<ReturnType<typeof buildApp>> & { rpcs: Rpc[] }) =>
  Effect.gen(function* () {
    const metrics = yield* Metrics;
    const configBuild = { chains, rpcs };

    yield* build
      .databaseDiagnostic({ preBuild })
      .pipe(failBuild("diagnostic", 75));
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

    const app: PonderApp = {
      preBuild,
      namespaceBuild,
      schemaBuild,
      indexingBuild,
      apiBuild,
      crashRecoveryCheckpoint,
    };

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
  });

/**
 * Run the indexer with the ordering of the app.
 *
 * @dev The resources of the indexer, such as its fibers and worker threads,
 * close when the indexer completes, fails, or is interrupted.
 */
export const runIndexing = (
  app: PonderApp,
): Effect.Effect<void, Error, Db | Metrics | Options> => {
  switch (app.preBuild.ordering) {
    case "omnichain":
      return Effect.scoped(runOmnichain(app));
    case "multichain":
      return Effect.scoped(runMultichain(app));
    case "experimental_isolated":
      return Effect.scoped(isolatedController(app));
  }
};
