import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { createBuild } from "@/build/index.js";
import { Db, makeDb, makeDbTransports } from "@/database/db.js";
import { SCHEMATA } from "@/database/index.js";
import { Metrics } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createRpcs } from "@/rpc/index.js";
import { makeServer } from "@/server/index.js";
import type { CliOptions } from "../ponder.js";
import {
  checkNodeVersion,
  failBuild,
  isBuildFailed,
  setVersionInfo,
} from "../utils/command.js";
import { runMain } from "../utils/exit.js";

export function serve({ cliOptions }: { cliOptions: CliOptions }) {
  const options = buildOptions({ cliOptions });

  const program = Effect.gen(function* () {
    const metrics = yield* Metrics;

    yield* checkNodeVersion;
    yield* setVersionInfo;

    const build = yield* createBuild({ cliOptions });

    const namespaceBuild = yield* build.namespaceCompile.pipe(
      failBuild("namespace"),
    );
    const configResult = yield* build.executeConfig.pipe(failBuild("config"));
    const schemaResult = yield* build.executeSchema.pipe(failBuild("schema"));
    const preBuild = yield* build
      .preCompile(configResult)
      .pipe(failBuild("pre-compile"));

    if (preBuild.databaseConfig.kind === "pglite") {
      yield* Effect.logError({
        msg: "The 'ponder serve' command does not support PGlite",
      });
      return 1;
    }

    const schemaBuild = yield* build
      .compileSchema({ ...schemaResult, preBuild })
      .pipe(failBuild("schema"));
    const { chains } = yield* build
      .compileConfig({ configResult })
      .pipe(failBuild("config"));
    const rpcs = yield* createRpcs(chains).pipe(failBuild("config"));
    const configBuild = { chains, rpcs };

    // Note: RPC diagnostic is skipped

    const db = yield* makeDb(
      yield* makeDbTransports({
        namespace: namespaceBuild,
        preBuild,
        schemaBuild,
      }),
    );
    yield* build
      .databaseDiagnostic({ preBuild })
      .pipe(failBuild("diagnostic", 75), Effect.provideService(Db, db));

    const schemas = yield* db.admin.query((db) =>
      db
        .select()
        .from(SCHEMATA)
        .where(eq(SCHEMATA.schemaName, namespaceBuild.schema)),
    );

    if (schemas.length === 0) {
      yield* Effect.logError({
        msg: "Schema does not exist.",
        schema: namespaceBuild.schema,
      });
      return 1;
    }

    const apiResult = yield* build
      .executeApi({ preBuild, configBuild })
      .pipe(failBuild("api"), Effect.provideService(Db, db));
    const apiBuild = yield* build
      .compileApi({ apiResult })
      .pipe(failBuild("api"));

    metrics.ponder_settings_info.set(
      {
        database: preBuild.databaseConfig.kind,
        command: cliOptions.command,
      },
      1,
    );

    yield* makeServer(apiBuild).pipe(Effect.provideService(Db, db));

    return yield* Effect.never;
  }).pipe(Effect.catchIf(isBuildFailed, ({ code }) => Effect.succeed(code)));

  runMain({ options, program });
}
