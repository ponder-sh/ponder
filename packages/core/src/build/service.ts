import { Hash, createHash } from "node:crypto";
import path from "node:path";
import type { Common } from "@/common/common.js";
import type { Config } from "@/config/config.js";
import type { DatabaseConfig } from "@/config/database.js";
import type { Network } from "@/config/networks.js";
import type { EventSource } from "@/config/sources.js";
import type { Schema } from "@/schema/types.js";
import { buildGraphqlSchema } from "@/server/graphql/buildGraphqlSchema.js";
import { glob } from "glob";
import type { GraphQLSchema } from "graphql";
import { type ViteDevServer, createServer } from "vite";
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
import { safeBuildSchema } from "./schema.js";
import { parseViteNodeError } from "./stacktrace.js";

export type Service = {
  // static
  common: Common;
  srcRegex: RegExp;

  // vite
  viteDevServer: ViteDevServer;
  viteNodeServer: ViteNodeServer;
  viteNodeRunner: ViteNodeRunner;

  // state
  hash: Hash;
};

export type Build = {
  // Build ID for caching
  buildId: string;
  // Config
  databaseConfig: DatabaseConfig;
  sources: EventSource[];
  networks: Network[];
  // Schema
  schema: Schema;
  graphqlSchema: GraphQLSchema;
  // Indexing functions
  indexingFunctions: IndexingFunctions;
};

export type BuildResult =
  | { status: "success"; build: Build }
  | { status: "error"; error: Error };

type RawBuild = {
  config: Config;
  schema: Schema;
  indexingFunctions: RawIndexingFunctions;
};

export const create = async ({
  common,
}: {
  common: Common;
}): Promise<Service> => {
  const escapeRegex = /[.*+?^${}()|[\]\\]/g;
  const escapedSrcDir = common.options.srcDir
    // If on Windows, use a POSIX path for this regex.
    .replace(/\\/g, "/")
    // Escape special characters in the path.
    .replace(escapeRegex, "\\$&");
  const srcRegex = new RegExp(`^${escapedSrcDir}/.*\\.(ts|js)$`);

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

  const hash = createHash("sha256");

  const viteDevServer = await createServer({
    root: common.options.rootDir,
    cacheDir: path.join(common.options.ponderDir, "vite"),
    publicDir: false,
    customLogger: viteLogger,
    server: { hmr: false },
    plugins: [
      viteTsconfigPathsPlugin(),
      vitePluginPonder((x: string) => {
        hash.update(x);
      }),
    ],
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

  return {
    common,
    srcRegex,
    viteDevServer,
    viteNodeServer,
    viteNodeRunner,
    hash,
  };
};

/**
 * Execute, validate, and build the files the make up a Ponder app.
 * If `watch` is true (dev server), then use vite to re-execute changed files,
 * and validate and build again. This function only re-executes changes files,
 * but doesn't attempt to skip any validation or build steps.
 */
export const start = async (
  buildService: Service,
  {
    watch,
    onBuild,
  }:
    | { watch: true; onBuild: (buildResult: BuildResult) => void }
    | { watch: false; onBuild?: never },
): Promise<BuildResult> => {
  const { common } = buildService;

  const [
    executeConfigResult,
    executeSchemaResult,
    executeIndexingFunctionsResult,
  ] = await Promise.all([
    executeConfig(buildService),
    executeSchema(buildService),
    executeIndexingFunctions(buildService),
  ]);

  if (executeConfigResult.status === "error") {
    return { status: "error", error: executeConfigResult.error };
  }
  if (executeSchemaResult.status === "error") {
    return { status: "error", error: executeSchemaResult.error };
  }
  if (executeIndexingFunctionsResult.status === "error") {
    return { status: "error", error: executeIndexingFunctionsResult.error };
  }

  const rawBuild: RawBuild = {
    config: executeConfigResult.config,
    schema: executeSchemaResult.schema,
    indexingFunctions: executeIndexingFunctionsResult.indexingFunctions,
  };

  const buildResult = await validateAndBuild(buildService, rawBuild);

  // If watch is false (`ponder start` or `ponder serve`),
  // don't register  any event handlers on the watcher.
  if (watch) {
    // Define the directories and files to ignore
    const ignoredDirs = [common.options.generatedDir, common.options.ponderDir];
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
      const invalidated = [
        ...buildService.viteNodeRunner.moduleCache.invalidateDepTree([file]),
      ];

      // If no files were invalidated, no need to reload.
      if (invalidated.length === 0) return;

      // Note that the paths in `invalidated` are POSIX, so we need to
      // convert the paths in `options` to POSIX for this comparison.
      // The `srcDir` regex is already converted to POSIX.
      const hasConfigUpdate = invalidated.includes(
        common.options.configFile.replace(/\\/g, "/"),
      );
      const hasSchemaUpdate = invalidated.includes(
        common.options.schemaFile.replace(/\\/g, "/"),
      );
      const hasIndexingFunctionUpdate = invalidated.some((file) =>
        buildService.srcRegex.test(file),
      );

      // This branch could trigger if you change a `note.txt` file within `src/`.
      // Note: We could probably do a better job filtering out files in `isFileIgnored`.
      if (!hasConfigUpdate && !hasSchemaUpdate && !hasIndexingFunctionUpdate) {
        return;
      }

      common.logger.info({
        service: "build",
        msg: `Hot reload ${invalidated
          .map((f) => `'${path.relative(common.options.rootDir, f)}'`)
          .join(", ")}`,
      });

      if (hasConfigUpdate) {
        const result = await executeConfig(buildService);
        if (result.status === "error") {
          onBuild({ status: "error", error: result.error });
          return;
        }
        rawBuild.config = result.config;
      }

      if (hasSchemaUpdate) {
        const result = await executeSchema(buildService);
        if (result.status === "error") {
          onBuild({ status: "error", error: result.error });
          return;
        }
        rawBuild.schema = result.schema;
      }

      if (hasIndexingFunctionUpdate) {
        const result = await executeIndexingFunctions(buildService);
        if (result.status === "error") {
          onBuild({ status: "error", error: result.error });
          return;
        }
        rawBuild.indexingFunctions = result.indexingFunctions;
      }

      const buildResult = await validateAndBuild(buildService, rawBuild);
      onBuild(buildResult);
    };

    buildService.viteDevServer.watcher.on("change", onFileChange);
  }

  return buildResult;
};

export const kill = async (buildService: Service): Promise<void> => {
  await buildService.viteDevServer?.close();
  buildService.common.logger.debug({
    service: "build",
    msg: "Killed build service",
  });
};

const executeConfig = async (
  buildService: Service,
): Promise<
  { status: "success"; config: Config } | { status: "error"; error: Error }
> => {
  const executeResult = await executeFile(buildService, {
    file: buildService.common.options.configFile,
  });

  if (executeResult.status === "error") {
    buildService.common.logger.error({
      service: "build",
      msg: "Error while executing 'ponder.config.ts':",
      error: executeResult.error,
    });

    return executeResult;
  }

  const config = executeResult.exports.default as Config;

  return { status: "success", config } as const;
};

const executeSchema = async (
  buildService: Service,
): Promise<
  { status: "success"; schema: Schema } | { status: "error"; error: Error }
> => {
  const executeResult = await executeFile(buildService, {
    file: buildService.common.options.schemaFile,
  });

  if (executeResult.status === "error") {
    buildService.common.logger.error({
      service: "build",
      msg: "Error while executing 'ponder.schema.ts':",
      error: executeResult.error,
    });

    return executeResult;
  }

  const schema = executeResult.exports.default as Schema;

  return { status: "success", schema };
};

const executeIndexingFunctions = async (
  buildService: Service,
): Promise<
  | { status: "success"; indexingFunctions: RawIndexingFunctions }
  | { status: "error"; error: Error }
> => {
  const pattern = path
    .join(buildService.common.options.srcDir, "**/*.{js,mjs,ts,mts}")
    .replace(/\\/g, "/");
  const files = glob.sync(pattern);

  const executeResults = await Promise.all(
    files.map(async (file) => ({
      ...(await executeFile(buildService, { file })),
      file,
    })),
  );

  const indexingFunctions: RawIndexingFunctions = [];

  for (const executeResult of executeResults) {
    if (executeResult.status === "error") {
      buildService.common.logger.error({
        service: "build",
        msg: `Error while executing '${path.relative(
          buildService.common.options.rootDir,
          executeResult.file,
        )}':`,
        error: executeResult.error,
      });

      return executeResult;
    }

    indexingFunctions.push(...(executeResult.exports?.ponder?.fns ?? []));
  }

  return { status: "success", indexingFunctions };
};

const validateAndBuild = async (
  { common, hash }: Pick<Service, "common" | "hash">,
  rawBuild: RawBuild,
): Promise<BuildResult> => {
  // Validate and build the schema
  const buildSchemaResult = safeBuildSchema({
    schema: rawBuild.schema,
  });
  if (buildSchemaResult.status === "error") {
    common.logger.error({
      service: "build",
      msg: "Error while building schema:",
      error: buildSchemaResult.error,
    });

    return buildSchemaResult;
  }

  const graphqlSchema = buildGraphqlSchema(buildSchemaResult.schema);

  // Validates and build the config
  const buildConfigAndIndexingFunctionsResult =
    await safeBuildConfigAndIndexingFunctions({
      config: rawBuild.config,
      rawIndexingFunctions: rawBuild.indexingFunctions,
      options: common.options,
    });
  if (buildConfigAndIndexingFunctionsResult.status === "error") {
    common.logger.error({
      service: "build",
      msg: "Failed build with error:",
      error: buildConfigAndIndexingFunctionsResult.error,
    });

    return buildConfigAndIndexingFunctionsResult;
  }

  for (const log of buildConfigAndIndexingFunctionsResult.logs) {
    common.logger[log.level]({ service: "build", msg: log.msg });
  }

  // const buildId = hash
  //   .update(JSON.stringify({ version: 1 }))
  //   .digest("hex")
  //   .slice(0, 16);

  return {
    status: "success",
    build: {
      buildId: "TODO:Kyle",
      databaseConfig: buildConfigAndIndexingFunctionsResult.databaseConfig,
      networks: buildConfigAndIndexingFunctionsResult.networks,
      sources: buildConfigAndIndexingFunctionsResult.sources,
      schema: buildSchemaResult.schema,
      graphqlSchema,
      indexingFunctions:
        buildConfigAndIndexingFunctionsResult.indexingFunctions,
    },
  };
};

const executeFile = async (
  { common, viteNodeRunner }: Service,
  { file }: { file: string },
): Promise<
  | {
      status: "success";
      exports: any;
    }
  | {
      status: "error";
      error: Error;
    }
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
