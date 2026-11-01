import fs from "node:fs";
import path from "node:path";
import { Cause, Deferred, Effect, Exit, Queue, Scope, Stream } from "effect";
import { createBuild } from "@/build/index.js";
import { Db, makeDb } from "@/database/db.js";
import { migrate, migrateSync } from "@/database/migrate.js";
import { NonRetryableUserError } from "@/internal/errors.js";
import { Metrics } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import type { IndexingBuild, PreBuild } from "@/internal/types.js";
import { makeServer } from "@/server/index.js";
import { createUi } from "@/ui/index.js";
import type { CliOptions } from "../ponder.js";
import { runCodegen } from "../utils/codegen.js";
import {
  checkNodeVersion,
  failBuild,
  isBuildFailed,
  setVersionInfo,
} from "../utils/command.js";
import { runMain } from "../utils/exit.js";
import { runIndexing } from "./start.js";

/** A build of the app or of the API only, or a stop of the app. */
type BuildRequest = "indexing" | "api" | "stop";

/** A running app, which an API build reuses. */
type App = {
  preBuild: PreBuild;
  configBuild: Pick<IndexingBuild, "chains" | "rpcs">;
  db: Db["Service"];
};

export function dev({ cliOptions }: { cliOptions: CliOptions }) {
  const options = buildOptions({ cliOptions });

  const program = Effect.gen(function* () {
    const metrics = yield* Metrics;
    const scope = yield* Scope.Scope;

    yield* checkNodeVersion;

    if (!fs.existsSync(path.join(options.rootDir, ".env.local"))) {
      yield* Effect.logWarning({
        msg: "Local environment file (.env.local) not found",
      });
    }

    yield* setVersionInfo;
    yield* runCodegen;

    const build = yield* createBuild({ cliOptions });

    if (cliOptions.disableUi !== true) {
      yield* createUi;
    }

    /** Builds that run one at a time. */
    const queue = yield* Queue.unbounded<BuildRequest>();
    /** The exit code of an error that stops the process. */
    const fatal = yield* Deferred.make<number>();

    /**
     * Stop the app until the next hot reload for a user error, else exit.
     */
    const onError = (
      msg: "uncaughtException" | "unhandledRejection",
      error: unknown,
    ) =>
      Effect.gen(function* () {
        yield* Effect.logError({ msg, error });

        if (error instanceof NonRetryableUserError) {
          // Note: A pending build replaces the app anyway.
          if ((yield* Queue.size(queue)) === 0) {
            yield* Queue.offer(queue, "stop");
          }
        } else {
          yield* Deferred.succeed(fatal, 75);
        }
      });

    const namespace = {
      schema: cliOptions.schema ?? process.env.DATABASE_SCHEMA ?? "public",
      viewsSchema: undefined,
    };

    globalThis.PONDER_NAMESPACE_BUILD = namespace;

    const runSync = Effect.runSyncWith(yield* Effect.context<never>());
    const onProcessError =
      (msg: "uncaughtException" | "unhandledRejection") => (error: Error) => {
        runSync(onError(msg, error));
      };

    process.on("uncaughtException", onProcessError("uncaughtException"));
    process.on("unhandledRejection", onProcessError("unhandledRejection"));

    let app: App | undefined;

    /** Resources of the app, such as the database and the indexer. */
    let indexingScope = yield* Scope.fork(scope);
    /** Resources of the API, such as the HTTP server. */
    let apiScope = yield* Scope.fork(scope);

    /** Stop the API, and the app unless `kind` is "api". */
    const stop = (kind: "indexing" | "api") =>
      Effect.gen(function* () {
        yield* Scope.close(apiScope, Exit.void);
        if (kind === "indexing") {
          app = undefined;
          yield* Scope.close(indexingScope, Exit.void);
          indexingScope = yield* Scope.fork(scope);
        }
        apiScope = yield* Scope.fork(scope);
      });

    /** {@link stop} after an error, until the next hot reload. */
    const fail = (kind: "indexing" | "api") =>
      Effect.andThen(
        stop(kind),
        Effect.sync(() => {
          metrics.hasError = true;
        }),
      );

    const buildIndexing = Effect.gen(function* () {
      metrics.resetIndexingMetrics();

      const configResult = yield* build.executeConfig.pipe(failBuild("config"));
      const schemaResult = yield* build.executeSchema.pipe(failBuild("schema"));
      const preBuild = yield* build
        .preCompile(configResult)
        .pipe(failBuild("pre-compile"));
      yield* build
        .databaseDiagnostic({ preBuild })
        .pipe(failBuild("diagnostic"));
      const schemaBuild = yield* build
        .compileSchema({ ...schemaResult, preBuild })
        .pipe(failBuild("schema"));
      const configBuild = yield* build
        .compileConfig({ configResult })
        .pipe(failBuild("config"), Scope.provide(indexingScope));

      yield* build.rpcDiagnostic({ configBuild }).pipe(failBuild("diagnostic"));
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

      const db = yield* makeDb({ namespace, preBuild, schemaBuild }).pipe(
        Scope.provide(indexingScope),
      );

      yield* Effect.gen(function* () {
        const crashRecoveryCheckpoint = yield* migrate({
          namespace,
          preBuild,
          schemaBuild,
          buildId: indexingBuild.buildId,
          chains: indexingBuild.chains,
          rpcs: indexingBuild.rpcs,
          finalizedBlocks: indexingBuild.finalizedBlocks,
        }).pipe(Scope.provide(indexingScope));

        yield* migrateSync;

        const apiResult = yield* build
          .executeApi({ preBuild, configBuild })
          .pipe(failBuild("api"), Scope.provide(apiScope));
        const apiBuild = yield* build
          .compileApi({ apiResult })
          .pipe(failBuild("api"));

        metrics.resetApiMetrics();
        metrics.ponder_settings_info.set(
          {
            ordering: preBuild.ordering,
            database: preBuild.databaseConfig.kind,
            command: cliOptions.command,
          },
          1,
        );

        metrics.initializeIndexingMetrics({ indexingBuild, schemaBuild });

        yield* runIndexing({
          preBuild,
          namespaceBuild: namespace,
          schemaBuild,
          indexingBuild,
          apiBuild,
          crashRecoveryCheckpoint,
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : onError("unhandledRejection", Cause.squash(cause)),
          ),
          Effect.forkIn(indexingScope, { startImmediately: true }),
        );

        yield* makeServer(apiBuild).pipe(Scope.provide(apiScope));

        app = { preBuild, configBuild, db };
      }).pipe(Effect.provideService(Db, db));
    });

    const buildApi = ({ preBuild, configBuild, db }: App) =>
      Effect.gen(function* () {
        metrics.resetApiMetrics();

        const apiResult = yield* build
          .executeApi({ preBuild, configBuild })
          .pipe(failBuild("api"), Scope.provide(apiScope));
        const apiBuild = yield* build
          .compileApi({ apiResult })
          .pipe(failBuild("api"));

        yield* makeServer(apiBuild).pipe(Scope.provide(apiScope));
      }).pipe(Effect.provideService(Db, db));

    const runBuild = (request: BuildRequest) => {
      if (request === "stop") return fail("indexing");

      // Note: An API build needs the database of a running app.
      const kind = request === "api" && app !== undefined ? "api" : "indexing";

      return Effect.gen(function* () {
        yield* stop(kind);
        yield* kind === "api" ? buildApi(app!) : buildIndexing;
      }).pipe(
        Effect.catchIf(isBuildFailed, () => fail(kind)),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : onError("unhandledRejection", Cause.squash(cause)),
        ),
      );
    };

    // Note: A hot reload replaces the pending builds.
    yield* build.reloads.pipe(
      Stream.runForEach((kind) =>
        Effect.andThen(Queue.clear(queue), Queue.offer(queue, kind)),
      ),
      Effect.forkScoped,
    );

    yield* Queue.offer(queue, "indexing");

    return yield* Effect.raceFirst(
      Effect.forever(Effect.flatMap(Queue.take(queue), runBuild)),
      Deferred.await(fatal),
    );
  });

  runMain({ options, program });
}
