import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isMainThread } from "node:worker_threads";
import { Effect, Queue, Result, type Scope, Stream } from "effect";
import { glob } from "glob";
import { Hono } from "hono";
import superjson from "superjson";
import { hexToNumber } from "viem";
import { createServer, createServerModuleRunner, normalizePath } from "vite";
import type { CliOptions } from "@/bin/ponder.js";
import type { Config } from "@/config/index.js";
import { Db } from "@/database/db.js";
import { MAX_DATABASE_OBJECT_NAME_LENGTH } from "@/drizzle/onchain.js";
import { setApiContext } from "@/internal/api.js";
import {
  BuildError,
  NonRetryableUserError,
  RetryableError,
} from "@/internal/errors.js";
import { externalIo } from "@/internal/io.js";
import {
  type LogMessage,
  type LogUnsafe,
  makeLogUnsafe,
} from "@/internal/logger.js";
import { Options } from "@/internal/options.js";
import type {
  ApiBuild,
  IndexingBuild,
  IndexingFunctions,
  NamespaceBuild,
  PreBuild,
  Schema,
  SchemaBuild,
} from "@/internal/types.js";
import { PONDER_SYNC_SCHEMAS } from "@/sync-store/schema.js";
import { getDatabaseName } from "@/utils/pg.js";
import { getNextAvailablePort } from "@/utils/port.js";
import { startClockEffect } from "@/utils/timer.js";
import { safeBuildConfig, safeBuildIndexingFunctions } from "./config.js";
import { type ApiModule, vitePluginPonder } from "./plugin.js";
import { safeBuildPre } from "./pre.js";
import { safeBuildSchema } from "./schema.js";
import { parseViteError } from "./stacktrace.js";

declare global {
  var PONDER_PRE_BUILD: PreBuild;
  var PONDER_NAMESPACE_BUILD: NamespaceBuild;
  var PONDER_INDEXING_BUILD: Pick<IndexingBuild, "chains" | "rpcs">;
  /** The values of the `ponder:api` virtual module for the current API build. */
  var PONDER_API_MODULE: ApiModule | undefined;
  /** Write a log outside a fiber, such as in a Drizzle column. */
  var PONDER_LOG_UNSAFE: LogUnsafe | undefined;
}

const BUILD_ID_VERSION = "2";

type ConfigResult = { config: Config; contentHash: string };
type SchemaResult = { schema: Schema; contentHash: string };
type IndexingResult = {
  indexingFunctions: IndexingFunctions;
  contentHash: string;
};
type ApiResult = { app: Hono };

export type Build = {
  executeConfig: Effect.Effect<ConfigResult, Error>;
  executeSchema: Effect.Effect<SchemaResult, Error>;
  executeIndexingFunctions: Effect.Effect<IndexingResult, Error>;
  /**
   * Run the API file with the services and scope of the API build.
   *
   * @dev The API functions and the `ponder:api` module use the services until
   * the scope closes.
   */
  executeApi: (params: {
    preBuild: PreBuild;
    configBuild: Pick<IndexingBuild, "chains" | "rpcs">;
  }) => Effect.Effect<ApiResult, Error, Db | Scope.Scope>;
  namespaceCompile: Effect.Effect<NamespaceBuild, BuildError>;
  preCompile: (params: {
    config: Config;
  }) => Effect.Effect<PreBuild, BuildError>;
  compileSchema: (params: {
    schema: Schema;
    preBuild: PreBuild;
  }) => Effect.Effect<SchemaBuild, BuildError>;
  /** Build the chains of the config. */
  compileConfig: (params: {
    configResult: ConfigResult;
  }) => Effect.Effect<Pick<IndexingBuild, "chains">, BuildError>;
  compileIndexing: (params: {
    configResult: ConfigResult;
    schemaResult: SchemaResult;
    indexingResult: IndexingResult;
    configBuild: Pick<IndexingBuild, "chains" | "rpcs">;
  }) => Effect.Effect<IndexingBuild, BuildError>;
  compileApi: (params: {
    apiResult: ApiResult;
  }) => Effect.Effect<ApiBuild, BuildError>;
  /**
   * Hot reloads in `ponder dev`. Listens for file changes while the stream
   * runs.
   */
  reloads: Stream.Stream<"indexing" | "api">;
  rpcDiagnostic: (params: {
    configBuild: Pick<IndexingBuild, "chains" | "rpcs">;
  }) => Effect.Effect<void, RetryableError>;
  /** Run a statement on the database, to check the connection. */
  databaseDiagnostic: (params: {
    preBuild: PreBuild;
  }) => Effect.Effect<void, RetryableError, Db>;
};

/**
 * Create the Vite dev server that runs the user's files. The server closes
 * when the scope closes.
 */
export const createBuild = ({
  cliOptions,
}: {
  /** The CLI options of the namespace. */
  cliOptions: Pick<CliOptions, "schema" | "viewsSchema">;
}): Effect.Effect<Build, never, Options | Scope.Scope> =>
  Effect.gen(function* () {
    const options = yield* Options;
    const logUnsafe = yield* makeLogUnsafe;

    const escapeRegex = /[.*+?^${}()|[\]\\]/g;

    globalThis.PONDER_LOG_UNSAFE = logUnsafe;

    const escapedIndexingDir = options.indexingDir
      // If on Windows, use a POSIX path for this regex.
      .replace(/\\/g, "/")
      // Escape special characters in the path.
      .replace(escapeRegex, "\\$&");
    const indexingRegex = new RegExp(
      `^${escapedIndexingDir}/(?!.*\\.(test|spec)\\.).*\\.(ts|js)$`,
    );

    const indexingPattern = path
      .join(options.indexingDir, "**/*.{js,mjs,ts,mts}")
      .replace(/\\/g, "/");

    const apiPattern = path
      .join(options.apiDir, "**/*.{js,mjs,ts,mts}")
      .replace(/\\/g, "/");

    const testFilePattern = path
      .join(options.indexingDir, "**/*.{test,spec}.{js,mjs,ts,mts}")
      .replace(/\\/g, "/");

    const viteLogger = {
      warnedMessages: new Set<string>(),
      loggedErrors: new WeakSet<Error>(),
      hasWarned: false,
      clearScreen() {},
      hasErrorLogged: (error: Error) => viteLogger.loggedErrors.has(error),
      info: (msg: string) => {
        logUnsafe(Effect.logTrace({ msg, action: "build" }));
      },
      warn: (msg: string) => {
        viteLogger.hasWarned = true;
        logUnsafe(Effect.logTrace({ msg, action: "build" }));
      },
      warnOnce: (msg: string) => {
        if (viteLogger.warnedMessages.has(msg)) return;
        viteLogger.hasWarned = true;
        logUnsafe(Effect.logTrace({ msg, action: "build" }));
        viteLogger.warnedMessages.add(msg);
      },
      error: (msg: string) => {
        viteLogger.hasWarned = true;
        logUnsafe(Effect.logTrace({ msg, action: "build" }));
      },
    };

    // Define the directories and files that `ponder dev` does not watch.
    const ignoredDirs = [options.generatedDir, options.ponderDir];
    const ignoredFiles = [
      path.join(options.rootDir, "ponder-env.d.ts"),
      path.join(options.rootDir, ".env.local"),
    ];

    const isFileIgnored = (filePath: string) => {
      const isInIgnoredDir = ignoredDirs.some((dir) => {
        const rel = path.relative(dir, filePath);
        return !rel.startsWith("..") && !path.isAbsolute(rel);
      });

      const isIgnoredFile = ignoredFiles.includes(filePath);
      return isInIgnoredDir || isIgnoredFile;
    };

    const viteDevServer = yield* Effect.acquireRelease(
      externalIo(
        Effect.promise(() =>
          createServer({
            root: options.rootDir,
            // Do not load a "vite.config.ts" file from the project root.
            configFile: false,
            cacheDir: path.join(options.ponderDir, "vite"),
            publicDir: false,
            appType: "custom",
            customLogger: viteLogger,
            server: {
              // Do not create an HTTP server or register a SIGTERM listener.
              middlewareMode: true,
              hmr: false,
              ws: false,
              // Only `ponder dev` uses the file watcher. Isolated worker threads do not.
              watch:
                options.command === "dev" && isMainThread
                  ? { ignored: isFileIgnored }
                  : null,
            },
            resolve: { tsconfigPaths: true },
            // Load `ponder` with Node instead of transforming it. This matters when `ponder`
            // is a linked package, which Vite does not externalize by default.
            ssr: { external: ["ponder"] },
            plugins: [vitePluginPonder(options)],
          }),
        ),
      ),
      (viteDevServer) =>
        externalIo(Effect.promise(() => viteDevServer.close())),
    );

    const ssrEnvironment = viteDevServer.environments.ssr;
    const moduleRunner = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createServerModuleRunner(ssrEnvironment, {
          hmr: false,
          sourcemapInterceptor: "prepareStackTrace",
        }),
      ),
      (moduleRunner) => externalIo(Effect.promise(() => moduleRunner.close())),
    );

    const invalidateDepTree = (files: string[]) => {
      const invalidated = new Set<string>();

      const invalidate = (id: string) => {
        const node = moduleRunner.evaluatedModules.getModuleById(id);
        if (node === undefined || invalidated.has(node.file)) return;
        invalidated.add(node.file);
        for (const importer of node.importers) invalidate(importer);
        moduleRunner.evaluatedModules.invalidateModule(node);
      };

      for (const file of files) {
        const nodes = moduleRunner.evaluatedModules.getModulesByFile(
          normalizePath(file),
        );
        for (const node of nodes ?? []) invalidate(node.id);
      }

      return invalidated;
    };

    /**
     * Run `file` and return its exports.
     */
    const executeFile = (file: string): Effect.Effect<any, Error> =>
      externalIo(
        Effect.tryPromise({
          try: () => moduleRunner.import(file),
          catch: (error) =>
            parseViteError(
              path.relative(options.rootDir, file),
              error as Error,
            ),
        }),
      );

    const executeFileWithTimeout = (file: string) =>
      executeFile(file).pipe(
        Effect.timeoutOrElse({
          duration: 10_000,
          orElse: () =>
            Effect.fail(
              new NonRetryableUserError(
                "File execution did not complete (waited 10s)",
              ),
            ),
        }),
      );

    const build = {
      executeConfig: Effect.gen(function* () {
        const exports = yield* executeFile(options.configFile).pipe(
          Effect.tapError((error) =>
            Effect.logError({
              msg: "Error while executing file",
              file: "ponder.config.ts",
              error,
            }),
          ),
        );

        const config = exports.default as Config;

        const contentHash = createHash("sha256")
          .update(
            superjson.stringify({
              ordering: config.ordering,
              contracts: config.contracts,
              accounts: config.accounts,
              blocks: config.blocks,
            }),
          )
          .digest("hex");

        return { config, contentHash };
      }),
      executeSchema: Effect.gen(function* () {
        const schema = yield* executeFile(options.schemaFile).pipe(
          Effect.tapError((error) =>
            Effect.logError({
              msg: "Error while executing file",
              file: "ponder.schema.ts",
              error,
            }),
          ),
        );

        const contents = fs.readFileSync(options.schemaFile, "utf-8");
        return {
          schema,
          contentHash: createHash("sha256").update(contents).digest("hex"),
        };
      }),
      executeIndexingFunctions: Effect.gen(function* () {
        const files = glob.sync(indexingPattern, {
          ignore: [apiPattern, testFilePattern],
        });

        for (const file of files) {
          yield* executeFileWithTimeout(file).pipe(
            Effect.tapError((error) =>
              Effect.logError({
                msg: "Error while executing file",
                file: path.relative(options.rootDir, file),
                error,
              }),
            ),
          );
        }

        // Note that we are only hashing the file contents, not the exports. This is
        // different from the config/schema, where we include the serializable object itself.
        const hash = createHash("sha256");
        for (const file of files) {
          try {
            const contents = fs.readFileSync(file, "utf-8");
            hash.update(contents);
          } catch (_e) {
            yield* Effect.logWarning({
              msg: "Unable to read file",
              file,
            });
            hash.update(file);
          }
        }
        const contentHash = hash.digest("hex");

        const exports = yield* Effect.promise(() =>
          moduleRunner.import("ponder:registry"),
        );

        return {
          indexingFunctions: exports.ponder.fns,
          contentHash,
        };
      }),
      executeApi: ({ preBuild, configBuild }) =>
        Effect.gen(function* () {
          globalThis.PONDER_PRE_BUILD = preBuild;
          globalThis.PONDER_INDEXING_BUILD = configBuild;
          yield* setApiContext;
          yield* setApiModule(configBuild);

          if (!fs.existsSync(options.apiFile)) {
            const error = new BuildError(
              `API endpoint file not found. Create a file at ${options.apiFile}. Read more: https://ponder.sh/docs/api-reference/ponder/api-endpoints`,
            );
            error.stack = undefined;

            return yield* Effect.fail(error);
          }

          const exports = yield* executeFile(options.apiFile).pipe(
            Effect.tapError((error) =>
              Effect.logError({
                msg: "Error while executing file",
                file: path.relative(options.rootDir, options.apiFile),
                error,
              }),
            ),
          );

          const app = exports.default;

          if (!(app instanceof Hono || app?.constructor?.name === "Hono")) {
            const error = new BuildError(
              "API endpoint file does not export a Hono instance as the default export. Read more: https://ponder.sh/docs/api-reference/ponder/api-endpoints",
            );
            error.stack = undefined;

            return yield* Effect.fail(error);
          }

          return { app };
        }),
      namespaceCompile: Effect.gen(function* () {
        if (
          cliOptions.schema === undefined &&
          process.env.DATABASE_SCHEMA === undefined
        ) {
          const error = new BuildError(
            `Database schema required. Specify with "DATABASE_SCHEMA" env var or "--schema" CLI flag. Read more: https://ponder.sh/docs/database#database-schema`,
          );
          error.stack = undefined;

          return yield* Effect.fail(error);
        }

        const schema = cliOptions.schema ?? process.env.DATABASE_SCHEMA!;
        const viewsSchema =
          cliOptions.viewsSchema ?? process.env.DATABASE_VIEWS_SCHEMA;

        if (viewsSchema === schema) {
          const error = new BuildError(
            "Views schema cannot be the same as the schema.",
          );
          error.stack = undefined;
          return yield* Effect.fail(error);
        }

        if ((PONDER_SYNC_SCHEMAS as readonly string[]).includes(schema)) {
          const error = new BuildError(
            `Invalid schema name. "${schema}" is a reserved schema name.`,
          );
          error.stack = undefined;
          return yield* Effect.fail(error);
        }

        if (
          viewsSchema !== undefined &&
          (PONDER_SYNC_SCHEMAS as readonly string[]).includes(viewsSchema)
        ) {
          const error = new BuildError(
            `Invalid views schema name. "${viewsSchema}" is a reserved schema name.`,
          );
          error.stack = undefined;
          return yield* Effect.fail(error);
        }

        if (schema.length > MAX_DATABASE_OBJECT_NAME_LENGTH) {
          const error = new BuildError(
            `Schema name cannot be longer than ${MAX_DATABASE_OBJECT_NAME_LENGTH} characters.`,
          );
          error.stack = undefined;
          return yield* Effect.fail(error);
        }

        if (
          viewsSchema &&
          viewsSchema.length > MAX_DATABASE_OBJECT_NAME_LENGTH
        ) {
          const error = new BuildError(
            `Views schema name cannot be longer than ${MAX_DATABASE_OBJECT_NAME_LENGTH} characters.`,
          );
          error.stack = undefined;
          return yield* Effect.fail(error);
        }

        globalThis.PONDER_NAMESPACE_BUILD = { schema, viewsSchema };

        return { schema, viewsSchema };
      }),
      preCompile: ({ config }) =>
        Effect.gen(function* () {
          const { databaseConfig, ordering, logs } = yield* safeBuildPre({
            config,
            options,
          });

          yield* writeLogs(logs);

          return { databaseConfig, ordering };
        }),
      compileSchema: ({ schema, preBuild }) =>
        Effect.map(safeBuildSchema({ schema, preBuild }), ({ statements }) => ({
          schema,
          statements,
        })),
      compileConfig: ({ configResult }) =>
        Effect.gen(function* () {
          // Validates and builds the config
          const { chains, logs } = yield* safeBuildConfig({
            config: configResult.config,
          });

          yield* writeLogs(logs);

          return { chains };
        }),
      compileIndexing: ({
        configResult,
        schemaResult,
        indexingResult,
        configBuild,
      }) =>
        Effect.gen(function* () {
          // Validates and builds the config
          const buildIndexingFunctionsResult =
            yield* safeBuildIndexingFunctions({
              config: configResult.config,
              indexingFunctions: indexingResult.indexingFunctions,
              configBuild,
            });

          yield* writeLogs(buildIndexingFunctionsResult.logs);

          const buildId = createHash("sha256")
            .update(BUILD_ID_VERSION)
            .update(configResult.contentHash)
            .update(schemaResult.contentHash)
            .update(indexingResult.contentHash)
            .digest("hex")
            .slice(0, 10);

          return {
            buildId,
            chains: buildIndexingFunctionsResult.chains,
            rpcs: buildIndexingFunctionsResult.rpcs,
            finalizedBlocks: buildIndexingFunctionsResult.finalizedBlocks,
            eventCallbacks: buildIndexingFunctionsResult.eventCallbacks,
            setupCallbacks: buildIndexingFunctionsResult.setupCallbacks,
            contracts: buildIndexingFunctionsResult.contracts,
            indexingFunctions: indexingResult.indexingFunctions,
          };
        }),
      compileApi: ({ apiResult }) =>
        Effect.gen(function* () {
          for (const route of apiResult.app.routes) {
            if (typeof route.path === "string") {
              if (
                route.path === "/ready" ||
                route.path === "/status" ||
                route.path === "/metrics" ||
                route.path === "/health" ||
                route.path === "/client"
              ) {
                const error = new BuildError(
                  `Validation failed: API route "${route.path}" is reserved for internal use.`,
                );
                error.stack = undefined;
                return yield* Effect.fail(error);
              }
            }
          }

          const port = yield* externalIo(
            getNextAvailablePort({
              port: options.port,
              hostname: options.hostname,
            }),
          ).pipe(
            // Note: An error other than a port in use is unexpected.
            Effect.orDie,
          );

          return {
            hostname: options.hostname,
            port,
            app: apiResult.app,
          };
        }),
      reloads: Stream.callback<"indexing" | "api">((queue) => {
        const onFileChange = (_file: string) => {
          const file = normalizePath(_file);

          // Invalidate the transform result for the updated file. Vite also does this
          // in its own watcher listener, but that listener can run after this one.
          ssrEnvironment.moduleGraph.onFileChange(file);

          // Invalidate all modules that depend on the updated files.
          // Note that `invalidateDepTree` returns POSIX paths, even on Windows.
          const invalidated = invalidateDepTree([file]);

          // Note: A file that failed to load, such as a config with a syntax
          // error, has no module to invalidate, but a fix to it needs a reload.
          if (invalidated.size === 0) invalidated.add(file);

          // Note that the paths in `invalidated` are POSIX, so we need to
          // convert the paths in `options` to POSIX for this comparison.
          // The `srcDir` regex is already converted to POSIX.
          const hasConfigUpdate = invalidated.has(
            options.configFile.replace(/\\/g, "/"),
          );
          const hasSchemaUpdate = invalidated.has(
            options.schemaFile.replace(/\\/g, "/"),
          );

          const hasIndexingUpdate = Array.from(invalidated).some(
            (file) => indexingRegex.test(file) && file !== options.apiFile,
          );
          const hasApiUpdate = Array.from(invalidated).some(
            (file) => file === options.apiFile,
          );

          // This branch could trigger if you change a `note.txt` file within `src/`.
          // Note: We could probably do a better job filtering out files in `isFileIgnored`.
          if (
            !hasConfigUpdate &&
            !hasSchemaUpdate &&
            !hasIndexingUpdate &&
            !hasApiUpdate
          ) {
            return;
          }

          logUnsafe(
            Effect.logInfo({
              msg: `Hot reload ${Array.from(invalidated)
                .map((f) => `"${path.relative(options.rootDir, f)}"`)
                .join(", ")}`,
            }),
          );

          // Fast path for when only the api has changed.
          if (
            hasApiUpdate === true &&
            hasConfigUpdate === false &&
            hasSchemaUpdate === false &&
            hasIndexingUpdate === false
          ) {
            invalidateDepTree([options.apiFile]);

            Queue.offerUnsafe(queue, "api");
          } else {
            // Instead, just invalidate the files that have changed and ...

            // re-execute all files
            invalidateDepTree([options.configFile]);
            invalidateDepTree([options.schemaFile]);
            invalidateDepTree(
              glob.sync(indexingPattern, {
                ignore: [apiPattern, testFilePattern],
              }),
            );
            invalidateDepTree(glob.sync(apiPattern));
            invalidateDepTree(["ponder:registry", "ponder:api"]);

            Queue.offerUnsafe(queue, "indexing");
          }
        };

        return Effect.acquireRelease(
          Effect.sync(() => viteDevServer.watcher.on("change", onFileChange)),
          () =>
            Effect.sync(() =>
              viteDevServer.watcher.off("change", onFileChange),
            ),
        );
      }),
      rpcDiagnostic: ({ configBuild }) =>
        Effect.gen(function* () {
          const endClock = yield* startClockEffect;

          // Note: Wait for every chain, then fail with the first error.
          const results = yield* Effect.all(
            configBuild.rpcs.map((rpc, index) =>
              Effect.gen(function* () {
                const chain = configBuild.chains[index]!;

                const rpcChainId = yield* rpc
                  .request(
                    { method: "eth_chainId" },
                    { logAnnotations: { action: "rpc_diagnostic" } },
                  )
                  .pipe(
                    Effect.flatMap((chainId) =>
                      Effect.try({
                        try: () => hexToNumber(chainId),
                        catch: (error) => error,
                      }),
                    ),
                    Effect.mapError(() => {
                      const error = new RetryableError(
                        "Failed to connect to JSON-RPC",
                      );
                      error.stack = undefined;
                      return error;
                    }),
                  );

                if (rpcChainId !== chain.id) {
                  yield* Effect.logWarning({
                    msg: "Configured chain ID does not match JSON-RPC response",
                    chain: chain.name,
                    chain_id: chain.id,
                    rpc_chain_id: rpcChainId,
                  });
                }

                yield* Effect.logInfo({
                  msg: "Connected to JSON-RPC",
                  chain: chain.name,
                  chain_id: chain.id,
                  hostnames: JSON.stringify(rpc.hostnames),
                  duration: yield* endClock,
                });
              }),
            ),
            { concurrency: "unbounded", mode: "result" },
          );

          for (const result of results) {
            if (Result.isFailure(result)) {
              return yield* Effect.fail(result.failure);
            }
          }
        }),
      databaseDiagnostic: ({ preBuild }) =>
        Effect.gen(function* () {
          const db = yield* Db;
          const endClock = yield* startClockEffect;
          const dialect = preBuild.databaseConfig.kind;

          yield* db.admin
            .query((db) => db.execute("SELECT version()"), {
              logAnnotations: { action: "database_diagnostic" },
            })
            .pipe(
              Effect.mapError((e) => {
                const error = new RetryableError(
                  `Failed to connect to ${dialect === "pglite" ? "PGlite database" : "database"}. Please check your database connection settings.\n\n${e.message}`,
                );
                error.stack = undefined;
                return error;
              }),
            );

          yield* Effect.logInfo({
            msg: "Connected to database",
            type: dialect,
            database:
              preBuild.databaseConfig.kind === "pglite"
                ? preBuild.databaseConfig.options.dataDir === "memory://"
                  ? "memory://"
                  : path.relative(
                      options.rootDir,
                      preBuild.databaseConfig.options.dataDir,
                    )
                : getDatabaseName(preBuild.databaseConfig.poolConfig),
            duration: yield* endClock,
          });
        }),
    } satisfies Build;

    return build;
  });

/**
 * Write the logs that the config, indexing function, and pre builds return.
 */
const writeLogs = (
  logs: ({ level: "warn" | "info" | "debug" } & LogMessage)[],
) =>
  Effect.forEach(
    logs,
    ({ level, ...log }) =>
      level === "warn"
        ? Effect.logWarning(log)
        : level === "info"
          ? Effect.logInfo(log)
          : Effect.logDebug(log),
    { discard: true },
  );

/**
 * Make the readonly database and the RPC requests of `configBuild` available
 * to the `ponder:api` virtual module until the scope closes.
 */
const setApiModule = (configBuild: Pick<IndexingBuild, "rpcs">) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const apiModule: ApiModule = {
      db: db.readonly.drizzle,
      requests: configBuild.rpcs.map(
        (rpc) => (body) => runPromise(rpc.request(body)),
      ),
    };

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        globalThis.PONDER_API_MODULE = apiModule;
      }),
      () =>
        Effect.sync(() => {
          if (globalThis.PONDER_API_MODULE === apiModule) {
            globalThis.PONDER_API_MODULE = undefined;
          }
        }),
    );
  });
