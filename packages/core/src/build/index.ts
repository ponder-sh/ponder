import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Common } from "@/common/common.js";
import { BuildError } from "@/common/errors.js";
import type { Config } from "@/config/config.js";
import type { DatabaseConfig } from "@/config/database.js";
import type { Network } from "@/config/networks.js";
import type { Schema } from "@/drizzle/index.js";
import type { SqlStatements } from "@/drizzle/kit/index.js";
import type { PonderRoutes } from "@/hono/index.js";
import type { Source } from "@/sync/source.js";
import { type Result, unwrapResults } from "@/utils/result.js";
import { serialize } from "@/utils/serialize.js";
import { glob } from "glob";
import type { GraphQLSchema } from "graphql";
import type { Hono } from "hono";
import { createServer } from "vite";
import { ViteNodeRunner } from "vite-node/client";
import { ViteNodeServer } from "vite-node/server";
import { installSourcemapsSupport } from "vite-node/source-map";
import { normalizeModuleId, toFilePath } from "vite-node/utils";
import viteTsconfigPathsPlugin from "vite-tsconfig-paths";
import {
  type IndexingFunctions,
  type RawIndexingFunctions,
  safeBuildConfigAndIndexingFunctions,
} from "./configAndIndexingFunctions.js";
import { vitePluginPonder } from "./plugin.js";
import { safeBuildPre } from "./pre.js";
import { safeBuildSchema } from "./schema.js";
import { parseViteNodeError } from "./stacktrace.js";

const BUILD_ID_VERSION = "1";

export type PreBuild = {
  databaseConfig: DatabaseConfig;
  namespace: string;
};

export type SchemaBuild = {
  schema: Schema;
  statements: SqlStatements;
  graphqlSchema: GraphQLSchema;
};

export type IndexingBuild = {
  buildId: string;
  sources: Source[];
  networks: Network[];
  indexingFunctions: IndexingFunctions;
};

export type ApiBuild = {
  app: Hono;
  routes: PonderRoutes;
};

export type BuildResultDev =
  | (Result<{
      preBuild: PreBuild;
      schemaBuild: SchemaBuild;
      indexingBuild: IndexingBuild;
      apiBuild: ApiBuild;
    }> & { kind: "indexing" })
  | (Result<ApiBuild> & { kind: "api" });

type ExecuteResult = {
  configResult: Result<{ config: Config; contentHash: string }>;
  schemaResult: Result<{ schema: Schema; contentHash: string }>;
  indexingResult: Result<{
    indexingFunctions: RawIndexingFunctions;
    contentHash: string;
  }>;
  apiResult: Result<{ app: Hono; routes: PonderRoutes }>;
};

export type Build = {
  execute: () => Promise<ExecuteResult>;
  preCompile: (params: { config: Config }) => Result<PreBuild>;
  compileSchema: (params: { schema: Schema }) => Result<SchemaBuild>;
  compileIndexing: (params: {
    configResult: Extract<
      ExecuteResult["configResult"],
      { status: "success" }
    >["result"];
    schemaResult: Extract<
      ExecuteResult["schemaResult"],
      { status: "success" }
    >["result"];
    indexingResult: Extract<
      ExecuteResult["indexingResult"],
      { status: "success" }
    >["result"];
  }) => Promise<Result<IndexingBuild>>;
  compileApi: (params: {
    apiResult: Extract<
      ExecuteResult["apiResult"],
      { status: "success" }
    >["result"];
  }) => Result<ApiBuild>;
  startDev: (params: {
    onBuild: (buildResult: BuildResultDev) => void;
  }) => void;
  kill: () => Promise<void>;
};

export const createBuild = async ({
  common,
}: {
  common: Common;
}): Promise<Build> => {
  const escapeRegex = /[.*+?^${}()|[\]\\]/g;

  const escapedIndexingDir = common.options.indexingDir
    // If on Windows, use a POSIX path for this regex.
    .replace(/\\/g, "/")
    // Escape special characters in the path.
    .replace(escapeRegex, "\\$&");
  const indexingRegex = new RegExp(`^${escapedIndexingDir}/.*\\.(ts|js)$`);

  const escapedApiDir = common.options.apiDir
    // If on Windows, use a POSIX path for this regex.
    .replace(/\\/g, "/")
    // Escape special characters in the path.
    .replace(escapeRegex, "\\$&");
  const apiRegex = new RegExp(`^${escapedApiDir}/.*\\.(ts|js)$`);

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
      common.logger.trace({ service: "build(vite)", msg });
    },
    warn: (msg: string) => {
      viteLogger.hasWarned = true;
      common.logger.trace({ service: "build(vite)", msg });
    },
    warnOnce: (msg: string) => {
      if (viteLogger.warnedMessages.has(msg)) return;
      viteLogger.hasWarned = true;
      common.logger.trace({ service: "build(vite)", msg });
      viteLogger.warnedMessages.add(msg);
    },
    error: (msg: string) => {
      viteLogger.hasWarned = true;
      common.logger.trace({ service: "build(vite)", msg });
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

  const executeConfig = async (): Promise<
    Awaited<ReturnType<Build["execute"]>>["configResult"]
  > => {
    const executeResult = await executeFile({
      file: common.options.configFile,
    });

    if (executeResult.status === "error") {
      common.logger.error({
        service: "build",
        msg: "Error while executing 'ponder.config.ts':",
        error: executeResult.error,
      });

      return executeResult;
    }

    const config = executeResult.exports.default as Config;

    const contentHash = crypto
      .createHash("sha256")
      .update(serialize(config))
      .digest("hex");

    return {
      status: "success",
      result: { config, contentHash },
    } as const;
  };

  const executeSchema = async (): Promise<
    Awaited<ReturnType<Build["execute"]>>["schemaResult"]
  > => {
    const executeResult = await executeFile({
      file: common.options.schemaFile,
    });

    if (executeResult.status === "error") {
      common.logger.error({
        service: "build",
        msg: "Error while executing 'ponder.schema.ts':",
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
        contentHash: crypto.createHash("sha256").update(contents).digest("hex"),
      },
    } as const;
  };

  const executeIndexingFunctions = async (): Promise<
    Awaited<ReturnType<Build["execute"]>>["indexingResult"]
  > => {
    const files = glob.sync(indexingPattern, {
      ignore: apiPattern,
    });
    const executeResults = await Promise.all(
      files.map(async (file) => ({
        ...(await executeFile({ file })),
        file,
      })),
    );

    for (const executeResult of executeResults) {
      if (executeResult.status === "error") {
        common.logger.error({
          service: "build",
          msg: `Error while executing '${path.relative(
            common.options.rootDir,
            executeResult.file,
          )}':`,
          error: executeResult.error,
        });

        return executeResult;
      }
    }

    // Note that we are only hashing the file contents, not the exports. This is
    // different from the config/schema, where we include the serializable object itself.
    const hash = crypto.createHash("sha256");
    for (const file of files) {
      try {
        const contents = fs.readFileSync(file, "utf-8");
        hash.update(contents);
      } catch (e) {
        common.logger.warn({
          service: "build",
          msg: `Unable to read contents of file '${file}' while constructin build ID`,
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
  };

  const executeApiRoutes = async (): Promise<
    Awaited<ReturnType<Build["execute"]>>["apiResult"]
  > => {
    const files = glob.sync(apiPattern);
    const executeResults = await Promise.all(
      files.map(async (file) => ({
        ...(await executeFile({ file })),
        file,
      })),
    );

    for (const executeResult of executeResults) {
      if (executeResult.status === "error") {
        common.logger.error({
          service: "build",
          msg: `Error while executing '${path.relative(
            common.options.rootDir,
            executeResult.file,
          )}':`,
          error: executeResult.error,
        });

        return executeResult;
      }
    }

    const exports = await viteNodeRunner.executeId("ponder:registry");

    return {
      status: "success",
      result: {
        app: exports.ponder.hono,
        routes: exports.ponder.routes,
      },
    };
  };

  let namespace = common.options.schema ?? process.env.DATABASE_SCHEMA;

  const build = {
    async execute(): Promise<ExecuteResult> {
      if (namespace === undefined) {
        if (common.options.command === "dev") {
          namespace = "public";
        } else {
          const error = new BuildError(
            "Database schema required. Specify with 'DATABASE_SCHEMA' env var or '--schema' CLI flag.",
          );
          return {
            configResult: { status: "error", error },
            schemaResult: { status: "error", error },
            indexingResult: { status: "error", error },
            apiResult: { status: "error", error },
          } as const;
        }
      }

      process.env.PONDER_DATABASE_SCHEMA = namespace;

      // Note: Don't run these in parallel. If there are circular imports in user code,
      // it's possible for ViteNodeRunner to return exports as undefined (a race condition).
      const configResult = await executeConfig();
      const schemaResult = await executeSchema();
      const indexingResult = await executeIndexingFunctions();
      const apiResult = await executeApiRoutes();

      return {
        configResult,
        schemaResult,
        indexingResult,
        apiResult,
      };
    },
    preCompile({ config }): Result<PreBuild> {
      const preBuild = safeBuildPre({
        config,
        options: common.options,
      });
      if (preBuild.status === "error") {
        common.logger.error({
          service: "build",
          msg: "Failed build",
          error: preBuild.error,
        });

        return preBuild;
      }

      for (const log of preBuild.logs) {
        common.logger[log.level]({ service: "build", msg: log.msg });
      }

      return {
        status: "success",
        result: {
          databaseConfig: preBuild.databaseConfig,
          namespace: namespace!,
        },
      } as const;
    },
    compileSchema({ schema }) {
      const buildSchemaResult = safeBuildSchema({
        schema,
      });

      if (buildSchemaResult.status === "error") {
        common.logger.error({
          service: "build",
          msg: "Error while building schema:",
          error: buildSchemaResult.error,
        });

        return buildSchemaResult;
      }

      return {
        status: "success",
        result: {
          schema,
          statements: buildSchemaResult.statements,
          graphqlSchema: buildSchemaResult.graphqlSchema,
        },
      } as const;
    },
    async compileIndexing({ configResult, schemaResult, indexingResult }) {
      // Validates and build the config
      const buildConfigAndIndexingFunctionsResult =
        await safeBuildConfigAndIndexingFunctions({
          config: configResult.config,
          rawIndexingFunctions: indexingResult.indexingFunctions,
        });
      if (buildConfigAndIndexingFunctionsResult.status === "error") {
        common.logger.error({
          service: "build",
          msg: "Failed build",
          error: buildConfigAndIndexingFunctionsResult.error,
        });

        return buildConfigAndIndexingFunctionsResult;
      }

      for (const log of buildConfigAndIndexingFunctionsResult.logs) {
        common.logger[log.level]({ service: "build", msg: log.msg });
      }

      const buildId = crypto
        .createHash("sha256")
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
          sources: buildConfigAndIndexingFunctionsResult.sources,
          networks: buildConfigAndIndexingFunctionsResult.networks,
          indexingFunctions:
            buildConfigAndIndexingFunctionsResult.indexingFunctions,
        },
      } as const;
    },
    compileApi({ apiResult }) {
      for (const {
        pathOrHandlers: [maybePathOrHandler],
      } of apiResult.routes) {
        if (typeof maybePathOrHandler === "string") {
          if (
            maybePathOrHandler === "/status" ||
            maybePathOrHandler === "/metrics" ||
            maybePathOrHandler === "/health"
          ) {
            const error = new BuildError(
              `Validation failed: API route "${maybePathOrHandler}" is reserved for internal use.`,
            );
            error.stack = undefined;
            common.logger.error({
              service: "build",
              msg: "Failed build",
              error,
            });
            return { status: "error", error } as const;
          }
        }
      }

      return {
        status: "success",
        result: {
          app: apiResult.app,
          routes: apiResult.routes,
        },
      };
    },
    async startDev({ onBuild }) {
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
          (file) => indexingRegex.test(file) && !apiRegex.test(file),
        );
        const hasApiUpdate = Array.from(invalidated).some((file) =>
          apiRegex.test(file),
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
          service: "build",
          msg: `Hot reload ${Array.from(invalidated)
            .map((f) => `'${path.relative(common.options.rootDir, f)}'`)
            .join(", ")}`,
        });

        // Fast path for when only the api has changed.
        if (
          hasApiUpdate === true &&
          hasConfigUpdate === false &&
          hasSchemaUpdate === false &&
          hasIndexingUpdate === false
        ) {
          const files = glob.sync(apiPattern);
          viteNodeRunner.moduleCache.invalidateDepTree(files);
          viteNodeRunner.moduleCache.deleteByModuleId("ponder:registry");

          const executeResult = await executeApiRoutes();
          if (executeResult.status === "error") {
            onBuild({
              status: "error",
              kind: "api",
              error: executeResult.error,
            });
            return;
          }

          onBuild({
            ...this.compileApi({ apiResult: executeResult.result }),
            kind: "api",
          });
        } else {
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

          const configResult = await executeConfig();
          const schemaResult = await executeSchema();
          const indexingResult = await executeIndexingFunctions();
          const apiResult = await executeApiRoutes();

          if (configResult.status === "error") {
            onBuild({
              status: "error",
              kind: "indexing",
              error: configResult.error,
            });
            return;
          }
          if (schemaResult.status === "error") {
            onBuild({
              status: "error",
              kind: "indexing",
              error: schemaResult.error,
            });
            return;
          }
          if (indexingResult.status === "error") {
            onBuild({
              status: "error",
              kind: "indexing",
              error: indexingResult.error,
            });
            return;
          }
          if (apiResult.status === "error") {
            onBuild({
              status: "error",
              kind: "indexing",
              error: apiResult.error,
            });
            return;
          }

          const compileResult = unwrapResults([
            build.preCompile(configResult.result),
            build.compileSchema(schemaResult.result),
            await build.compileIndexing({
              configResult: configResult.result,
              schemaResult: schemaResult.result,
              indexingResult: indexingResult.result,
            }),
            build.compileApi({ apiResult: apiResult.result }),
          ]);

          if (compileResult.status === "error") {
            onBuild({
              status: "error",
              kind: "indexing",
              error: compileResult.error,
            });
            return;
          }

          onBuild({
            status: "success",
            kind: "indexing",
            result: {
              preBuild: compileResult.result[0],
              schemaBuild: compileResult.result[1],
              indexingBuild: compileResult.result[2],
              apiBuild: compileResult.result[3],
            },
          });
        }
      };

      viteDevServer.watcher.on("change", onFileChange);
    },
    async kill() {
      await viteDevServer?.close();
      common.logger.debug({
        service: "build",
        msg: "Killed build service",
      });
    },
  } satisfies Build;

  return build;
};
