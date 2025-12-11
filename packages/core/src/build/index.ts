import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CliOptions } from "@/bin/ponder.js";
import type { Config } from "@/config/index.js";
import type { Database } from "@/database/index.js";
import { createQB } from "@/database/queryBuilder.js";
import type { Common } from "@/internal/common.js";
import {
  BuildError,
  NonRetryableUserError,
  RetryableError,
} from "@/internal/errors.js";
import type {
  ApiBuild,
  IndexingBuild,
  IndexingFunctions,
  NamespaceBuild,
  PreBuild,
  Schema,
  SchemaBuild,
} from "@/internal/types.js";
import { createPool, getDatabaseName } from "@/utils/pg.js";
import { createPglite } from "@/utils/pglite.js";
import { getNextAvailablePort } from "@/utils/port.js";
import type { Result } from "@/utils/result.js";
import { startClock } from "@/utils/timer.js";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { glob } from "glob";
import { Hono } from "hono";
import superjson from "superjson";
import { hexToNumber } from "viem";
import { createServer } from "vite";
import { ViteNodeRunner } from "vite-node/client";
import { ViteNodeServer } from "vite-node/server";
import { installSourcemapsSupport } from "vite-node/source-map";
import { normalizeModuleId, toFilePath } from "vite-node/utils";
import viteTsconfigPathsPlugin from "vite-tsconfig-paths";
import { safeBuildConfig, safeBuildIndexingFunctions } from "./config.js";
import { vitePluginPonder } from "./plugin.js";
import { safeBuildPre } from "./pre.js";
import { safeBuildSchema } from "./schema.js";
import { parseViteNodeError } from "./stacktrace.js";

declare global {
  var PONDER_COMMON: Common;
  var PONDER_PRE_BUILD: PreBuild;
  var PONDER_NAMESPACE_BUILD: NamespaceBuild;
  var PONDER_INDEXING_BUILD: Pick<IndexingBuild, "chains" | "rpcs">;
  var PONDER_DATABASE: Database;
}

const BUILD_ID_VERSION = "2";

type ConfigResult = Result<{ config: Config; contentHash: string }>;
type SchemaResult = Result<{ schema: Schema; contentHash: string }>;
type IndexingResult = Result<{
  indexingFunctions: IndexingFunctions;
  contentHash: string;
}>;
type ApiResult = Result<{ app: Hono }>;

export type Build = {
  executeConfig: () => Promise<ConfigResult>;
  executeSchema: () => Promise<SchemaResult>;
  executeIndexingFunctions: () => Promise<IndexingResult>;
  executeApi: (params: {
    preBuild: PreBuild;
    configBuild: Pick<IndexingBuild, "chains" | "rpcs">;
    database: Database;
  }) => Promise<ApiResult>;
  namespaceCompile: () => Result<NamespaceBuild>;
  preCompile: (params: { config: Config }) => Result<PreBuild>;
  compileSchema: (params: {
    schema: Schema;
    preBuild: PreBuild;
  }) => Result<SchemaBuild>;
  compileConfig: (params: {
    configResult: Extract<ConfigResult, { status: "success" }>["result"];
  }) => Result<Pick<IndexingBuild, "chains" | "rpcs">>;
  compileIndexing: (params: {
    configResult: Extract<ConfigResult, { status: "success" }>["result"];
    schemaResult: Extract<SchemaResult, { status: "success" }>["result"];
    indexingResult: Extract<IndexingResult, { status: "success" }>["result"];
    configBuild: Pick<IndexingBuild, "chains" | "rpcs">;
  }) => Promise<Result<IndexingBuild>>;
  compileApi: (params: {
    apiResult: Extract<ApiResult, { status: "success" }>["result"];
  }) => Promise<Result<ApiBuild>>;
  startDev: (params: { onReload: (kind: "indexing" | "api") => void }) => void;
  rpcDiagnostic: (params: {
    configBuild: Pick<IndexingBuild, "chains" | "rpcs">;
  }) => Promise<Result<void>>;
  databaseDiagnostic: (params: { preBuild: PreBuild }) => Promise<Result<void>>;
};

export const createBuild = async ({
  common,
  cliOptions,
}: {
  common: Common;
  cliOptions: CliOptions;
}): Promise<Build> => {
  const escapeRegex = /[.*+?^${}()|[\]\\]/g;

  globalThis.PONDER_COMMON = common;

  const escapedIndexingDir = common.options.indexingDir
    // If on Windows, use a POSIX path for this regex.
    .replace(/\\/g, "/")
    // Escape special characters in the path.
    .replace(escapeRegex, "\\$&");
  const indexingRegex = new RegExp(`^${escapedIndexingDir}/.*\\.(ts|js)$`);

  const indexingPattern = path
    .join(common.options.indexingDir, "**/*.{js,mjs,ts,mts}")
    .replace(/\\/g, "/");

  const apiPattern = path
    .join(common.options.apiDir, "**/*.{js,mjs,ts,mts}")
    .replace(/\\/g, "/");

  const viteLogger = {
    warnedMessages: new Set<string>(),
    loggedErrors: new WeakSet<Error>(),
    hasWarned: false,
    clearScreen() {},
    hasErrorLogged: (error: Error) => viteLogger.loggedErrors.has(error),
    info: (msg: string) => {
      common.logger.trace({ msg, action: "build" });
    },
    warn: (msg: string) => {
      viteLogger.hasWarned = true;
      common.logger.trace({ msg, action: "build" });
    },
    warnOnce: (msg: string) => {
      if (viteLogger.warnedMessages.has(msg)) return;
      viteLogger.hasWarned = true;
      common.logger.trace({ msg, action: "build" });
      viteLogger.warnedMessages.add(msg);
    },
    error: (msg: string) => {
      viteLogger.hasWarned = true;
      common.logger.trace({ msg, action: "build" });
    },
  };

  const viteDevServer = await createServer({
    root: common.options.rootDir,
    cacheDir: path.join(common.options.ponderDir, "vite"),
    publicDir: false,
    customLogger: viteLogger,
    server: { hmr: false },
    plugins: [viteTsconfigPathsPlugin(), vitePluginPonder(common.options)],
  });

  common.buildShutdown.add(() => viteDevServer.close());

  // This is Vite boilerplate (initializes the Rollup container).
  await viteDevServer.pluginContainer.buildStart({});

  const viteNodeServer = new ViteNodeServer(viteDevServer);
  installSourcemapsSupport({
    getSourceMap: (source) => viteNodeServer.getSourceMap(source),
  });

  const viteNodeRunner = new ViteNodeRunner({
    root: viteDevServer.config.root,
    fetchModule: (id) => viteNodeServer.fetchModule(id, "ssr"),
    resolveId: (id, importer) => viteNodeServer.resolveId(id, importer, "ssr"),
    debug: (process.env.DEBUG ?? "").includes("vite-node"),
  });

  const executeFile = async ({
    file,
  }: { file: string }): Promise<
    { status: "success"; exports: any } | { status: "error"; error: Error }
  > => {
    try {
      const exports = await viteNodeRunner.executeFile(file);
      return { status: "success", exports } as const;
    } catch (error_) {
      const relativePath = path.relative(common.options.rootDir, file);
      const error = parseViteNodeError(relativePath, error_ as Error);
      return { status: "error", error } as const;
    }
  };

  const executeFileWithTimeout = async ({
    file,
  }: { file: string }): Promise<
    { status: "success"; exports: any } | { status: "error"; error: Error }
  > => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeout = new Promise<NonRetryableUserError>((resolve) => {
      timeoutId = setTimeout(
        () =>
          resolve(
            new NonRetryableUserError(
              "File execution did not complete (waited 10s)",
            ),
          ),
        10_000,
      );
    });

    const res = await Promise.race([executeFile({ file }), timeout]);
    if (res instanceof NonRetryableUserError) {
      return { status: "error", error: res };
    }

    clearTimeout(timeoutId!);
    return res;
  };

  const build = {
    async executeConfig(): Promise<ConfigResult> {
      const executeResult = await executeFile({
        file: common.options.configFile,
      });

      if (executeResult.status === "error") {
        common.logger.error({
          msg: "Error while executing file",
          file: "ponder.config.ts",
          error: executeResult.error,
        });

        return executeResult;
      }

      const config = executeResult.exports.default as Config;

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

      return {
        status: "success",
        result: { config, contentHash },
      } as const;
    },
    async executeSchema(): Promise<SchemaResult> {
      const executeResult = await executeFile({
        file: common.options.schemaFile,
      });

      if (executeResult.status === "error") {
        common.logger.error({
          msg: "Error while executing file",
          file: "ponder.schema.ts",
          error: executeResult.error,
        });

        return executeResult;
      }

      const schema = executeResult.exports;

      const contents = fs.readFileSync(common.options.schemaFile, "utf-8");
      return {
        status: "success",
        result: {
          schema,
          contentHash: createHash("sha256").update(contents).digest("hex"),
        },
      } as const;
    },
    async executeIndexingFunctions(): Promise<IndexingResult> {
      const files = glob.sync(indexingPattern, {
        ignore: apiPattern,
      });

      for (const file of files) {
        const executeResult = await executeFileWithTimeout({ file });

        if (executeResult.status === "error") {
          common.logger.error({
            msg: "Error while executing file",
            file: path.relative(common.options.rootDir, file),
            error: executeResult.error,
          });
          return executeResult;
        }
      }

      // Note that we are only hashing the file contents, not the exports. This is
      // different from the config/schema, where we include the serializable object itself.
      const hash = createHash("sha256");
      for (const file of files) {
        try {
          const contents = fs.readFileSync(file, "utf-8");
          hash.update(contents);
        } catch (e) {
          common.logger.warn({
            msg: "Unable to read file",
            file,
          });
          hash.update(file);
        }
      }
      const contentHash = hash.digest("hex");

      const exports = await viteNodeRunner.executeId("ponder:registry");

      return {
        status: "success",
        result: {
          indexingFunctions: exports.ponder.fns,
          contentHash,
        },
      };
    },
    async executeApi({ preBuild, configBuild, database }): Promise<ApiResult> {
      globalThis.PONDER_PRE_BUILD = preBuild;
      globalThis.PONDER_INDEXING_BUILD = configBuild;
      globalThis.PONDER_DATABASE = database;

      if (!fs.existsSync(common.options.apiFile)) {
        const error = new BuildError(
          `API endpoint file not found. Create a file at ${common.options.apiFile}. Read more: https://ponder.sh/docs/api-reference/ponder/api-endpoints`,
        );
        error.stack = undefined;

        return { status: "error", error };
      }

      const executeResult = await executeFile({
        file: common.options.apiFile,
      });

      if (executeResult.status === "error") {
        common.logger.error({
          msg: "Error while executing file",
          file: path.relative(common.options.rootDir, common.options.apiFile),
          error: executeResult.error,
        });

        return executeResult;
      }

      const app = executeResult.exports.default;

      if (!(app instanceof Hono || app?.constructor?.name === "Hono")) {
        const error = new BuildError(
          "API endpoint file does not export a Hono instance as the default export. Read more: https://ponder.sh/docs/api-reference/ponder/api-endpoints",
        );
        error.stack = undefined;

        return { status: "error", error };
      }

      return {
        status: "success",
        result: { app },
      };
    },
    namespaceCompile() {
      if (
        cliOptions.schema === undefined &&
        process.env.DATABASE_SCHEMA === undefined
      ) {
        const error = new BuildError(
          `Database schema required. Specify with "DATABASE_SCHEMA" env var or "--schema" CLI flag. Read more: https://ponder.sh/docs/database#database-schema`,
        );
        error.stack = undefined;

        return { status: "error", error } as const;
      }

      const schema = cliOptions.schema ?? process.env.DATABASE_SCHEMA!;
      const viewsSchema =
        cliOptions.viewsSchema ?? process.env.DATABASE_VIEWS_SCHEMA;

      globalThis.PONDER_NAMESPACE_BUILD = { schema, viewsSchema };

      return {
        status: "success",
        result: { schema, viewsSchema },
      } as const;
    },
    preCompile({ config }): Result<PreBuild> {
      const preBuild = safeBuildPre({ config, options: common.options });
      if (preBuild.status === "error") {
        return preBuild;
      }

      return {
        status: "success",
        result: {
          databaseConfig: preBuild.databaseConfig,
          ordering: preBuild.ordering,
        },
      } as const;
    },
    compileSchema({ schema, preBuild }) {
      const buildSchemaResult = safeBuildSchema({ schema, preBuild });

      if (buildSchemaResult.status === "error") {
        return buildSchemaResult;
      }

      return {
        status: "success",
        result: {
          schema,
          statements: buildSchemaResult.statements,
        },
      } as const;
    },
    compileConfig({ configResult }) {
      // Validates and builds the config
      const buildConfigResult = safeBuildConfig({
        common,
        config: configResult.config,
      });
      if (buildConfigResult.status === "error") {
        return buildConfigResult;
      }

      for (const log of buildConfigResult.logs) {
        const { level, ...rest } = log;
        common.logger[level](rest);
      }

      return {
        status: "success",
        result: {
          chains: buildConfigResult.chains,
          rpcs: buildConfigResult.rpcs,
        },
      } as const;
    },
    async compileIndexing({
      configResult,
      schemaResult,
      indexingResult,
      configBuild,
    }) {
      // Validates and builds the config
      const buildIndexingFunctionsResult = await safeBuildIndexingFunctions({
        common,
        config: configResult.config,
        indexingFunctions: indexingResult.indexingFunctions,
        configBuild,
      });
      if (buildIndexingFunctionsResult.status === "error") {
        return buildIndexingFunctionsResult;
      }

      for (const log of buildIndexingFunctionsResult.logs) {
        const { level, ...rest } = log;
        common.logger[level](rest);
      }

      const buildId = createHash("sha256")
        .update(BUILD_ID_VERSION)
        .update(configResult.contentHash)
        .update(schemaResult.contentHash)
        .update(indexingResult.contentHash)
        .digest("hex")
        .slice(0, 10);

      return {
        status: "success",
        result: {
          buildId,
          chains: buildIndexingFunctionsResult.chains,
          rpcs: buildIndexingFunctionsResult.rpcs,
          finalizedBlocks: buildIndexingFunctionsResult.finalizedBlocks,
          eventCallbacks: buildIndexingFunctionsResult.eventCallbacks,
          setupCallbacks: buildIndexingFunctionsResult.setupCallbacks,
          contracts: buildIndexingFunctionsResult.contracts,
          indexingFunctions: indexingResult.indexingFunctions,
        },
      } as const;
    },
    async compileApi({ apiResult }) {
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
            return { status: "error", error } as const;
          }
        }
      }

      const port = await getNextAvailablePort({ common });

      return {
        status: "success",
        result: {
          hostname: common.options.hostname,
          port,
          app: apiResult.app,
        },
      };
    },
    async startDev({ onReload }) {
      // Define the directories and files to ignore
      const ignoredDirs = [
        common.options.generatedDir,
        common.options.ponderDir,
      ];
      const ignoredFiles = [
        path.join(common.options.rootDir, "ponder-env.d.ts"),
        path.join(common.options.rootDir, ".env.local"),
      ];

      const isFileIgnored = (filePath: string) => {
        const isInIgnoredDir = ignoredDirs.some((dir) => {
          const rel = path.relative(dir, filePath);
          return !rel.startsWith("..") && !path.isAbsolute(rel);
        });

        const isIgnoredFile = ignoredFiles.includes(filePath);
        return isInIgnoredDir || isIgnoredFile;
      };

      const onFileChange = async (_file: string) => {
        if (isFileIgnored(_file)) return;

        // Note that `toFilePath` always returns a POSIX path, even if you pass a Windows path.
        const file = toFilePath(
          normalizeModuleId(_file),
          common.options.rootDir,
        ).path;

        // Invalidate all modules that depend on the updated files.
        // Note that `invalidateDepTree` accepts and returns POSIX paths, even on Windows.
        const invalidated = viteNodeRunner.moduleCache.invalidateDepTree([
          file,
        ]);

        // If no files were invalidated, no need to reload.
        if (invalidated.size === 0) return;

        // Note that the paths in `invalidated` are POSIX, so we need to
        // convert the paths in `options` to POSIX for this comparison.
        // The `srcDir` regex is already converted to POSIX.
        const hasConfigUpdate = invalidated.has(
          common.options.configFile.replace(/\\/g, "/"),
        );
        const hasSchemaUpdate = invalidated.has(
          common.options.schemaFile.replace(/\\/g, "/"),
        );

        const hasIndexingUpdate = Array.from(invalidated).some(
          (file) => indexingRegex.test(file) && file !== common.options.apiFile,
        );
        const hasApiUpdate = Array.from(invalidated).some(
          (file) => file === common.options.apiFile,
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

        common.logger.info({
          msg: `Hot reload ${Array.from(invalidated)
            .map((f) => `"${path.relative(common.options.rootDir, f)}"`)
            .join(", ")}`,
        });

        // Fast path for when only the api has changed.
        if (
          hasApiUpdate === true &&
          hasConfigUpdate === false &&
          hasSchemaUpdate === false &&
          hasIndexingUpdate === false
        ) {
          viteNodeRunner.moduleCache.invalidateDepTree([
            common.options.apiFile,
          ]);

          onReload("api");
        } else {
          // Instead, just invalidate the files that have changed and ...

          // re-execute all files
          viteNodeRunner.moduleCache.invalidateDepTree([
            common.options.configFile,
          ]);
          viteNodeRunner.moduleCache.invalidateDepTree([
            common.options.schemaFile,
          ]);
          viteNodeRunner.moduleCache.invalidateDepTree(
            glob.sync(indexingPattern, {
              ignore: apiPattern,
            }),
          );
          viteNodeRunner.moduleCache.invalidateDepTree(glob.sync(apiPattern));
          viteNodeRunner.moduleCache.deleteByModuleId("ponder:registry");
          viteNodeRunner.moduleCache.deleteByModuleId("ponder:api");

          onReload("indexing");
        }
      };

      viteDevServer.watcher.on("change", onFileChange);
    },
    async rpcDiagnostic({ configBuild }) {
      const context = {
        logger: common.logger.child({ action: "rpc_diagnostic" }),
      };
      const endClock = startClock();

      const results = await Promise.all(
        configBuild.rpcs.map(async (rpc, index) => {
          const chain = configBuild.chains[index]!;
          try {
            const chainId = await rpc.request(
              { method: "eth_chainId" },
              context,
            );

            if (hexToNumber(chainId) !== chain.id) {
              common.logger.warn({
                msg: "Configured chain ID does not match JSON-RPC response",
                chain: chain.name,
                chain_id: chain.id,
                rpc_chain_id: hexToNumber(chainId),
              });
            }
          } catch (e) {
            const error = new RetryableError("Failed to connect to JSON-RPC");
            error.stack = undefined;
            return { status: "error", error } as const;
          }

          common.logger.info({
            msg: "Connected to JSON-RPC",
            chain: chain.name,
            chain_id: chain.id,
            hostnames: JSON.stringify(rpc.hostnames),
            duration: endClock(),
          });

          return { status: "success", result: undefined } as const;
        }),
      );

      for (const result of results) {
        if (result.status === "error") {
          return result;
        }
      }

      return { status: "success", result: undefined };
    },
    async databaseDiagnostic({ preBuild }) {
      const context = {
        logger: common.logger.child({ action: "database_diagnostic" }),
      };
      const endClock = startClock();

      const dialect = preBuild.databaseConfig.kind;
      if (dialect === "pglite") {
        const driver = createPglite(preBuild.databaseConfig.options);
        const qb = createQB(drizzlePglite(driver), { common });
        try {
          await qb.wrap((db) => db.execute("SELECT version()"), context);
        } catch (e) {
          const error = new RetryableError(
            `Failed to connect to PGlite database. Please check your database connection settings.\n\n${(e as any).message}`,
          );
          error.stack = undefined;
          return { status: "error", error };
        } finally {
          await driver.close();
        }

        const pgliteDir = preBuild.databaseConfig.options.dataDir;

        const pglitePath =
          pgliteDir === "memory://"
            ? "memory://"
            : path.relative(common.options.rootDir, pgliteDir);
        common.logger.info({
          msg: "Connected to database",
          type: dialect,
          database: pglitePath,
          duration: endClock(),
        });
      } else if (dialect === "postgres") {
        const pool = createPool(
          {
            ...preBuild.databaseConfig.poolConfig,
            application_name: "test",
            max: 1,
            statement_timeout: 10_000,
          },
          common.logger,
        );
        const qb = createQB(drizzleNodePostgres(pool), { common });
        try {
          await qb.wrap((db) => db.execute("SELECT version()"), context);
        } catch (e) {
          const error = new RetryableError(
            `Failed to connect to database. Please check your database connection settings.\n\n${(e as any).message}`,
          );
          error.stack = undefined;
          return { status: "error", error };
        } finally {
          await pool.end();
        }

        const connectionString =
          preBuild.databaseConfig.poolConfig.connectionString!;
        common.logger.info({
          msg: "Connected to database",
          type: dialect,
          database: getDatabaseName(connectionString),
          duration: endClock(),
        });
      }

      return { status: "success", result: undefined };
    },
  } satisfies Build;

  return build;
};
