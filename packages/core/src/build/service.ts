import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Common } from "@/common/common.js";
import { BuildError } from "@/common/errors.js";
import type { Config, OptionsConfig } from "@/config/config.js";
import type { DatabaseConfig } from "@/config/database.js";
import type { Network } from "@/config/networks.js";
import type { EventSource } from "@/config/sources.js";
import { buildGraphQLSchema } from "@/graphql/buildGraphqlSchema.js";
import type { PonderRoutes } from "@/hono/index.js";
import type { Schema } from "@/schema/common.js";
import { glob } from "glob";
import type { GraphQLSchema } from "graphql";
import type { Hono } from "hono";
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

const BUILD_ID_VERSION = "1";

export type Service = {
  // static
  common: Common;
  indexingRegex: RegExp;
  apiRegex: RegExp;
  indexingPattern: string;
  apiPattern: string;

  // vite
  viteDevServer: ViteDevServer;
  viteNodeServer: ViteNodeServer;
  viteNodeRunner: ViteNodeRunner;
};

type BaseBuild = {
  // Build ID for caching
  buildId: string;
  // Config
  databaseConfig: DatabaseConfig;
  optionsConfig: OptionsConfig;
  sources: EventSource[];
  networks: Network[];
  // Schema
  schema: Schema;
  graphqlSchema: GraphQLSchema;
};

export type IndexingBuild = BaseBuild & {
  indexingFunctions: IndexingFunctions;
};

export type ApiBuild = BaseBuild & {
  app: Hono;
  routes: PonderRoutes;
};

export type IndexingBuildResult =
  | { status: "success"; build: IndexingBuild }
  | { status: "error"; error: Error };

export type ApiBuildResult =
  | { status: "success"; build: ApiBuild }
  | { status: "error"; error: Error };

export const create = async ({
  common,
}: {
  common: Common;
}): Promise<Service> => {
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
    plugins: [viteTsconfigPathsPlugin(), vitePluginPonder()],
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
    indexingRegex,
    apiRegex,
    indexingPattern,
    apiPattern,
    viteDevServer,
    viteNodeServer,
    viteNodeRunner,
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
    onIndexingBuild,
    onApiBuild,
  }:
    | {
        watch: true;
        onIndexingBuild: (buildResult: IndexingBuildResult) => void;
        onApiBuild: (buildResult: ApiBuildResult) => void;
      }
    | { watch: false; onIndexingBuild?: never; onApiBuild?: never },
): Promise<{ indexing: IndexingBuildResult; api: ApiBuildResult }> => {
  const { common } = buildService;

  // Note: Don't run these in parallel. If there are circular imports in user code,
  // it's possible for ViteNodeRunner to return exports as undefined (a race condition).
  const configResult = await executeConfig(buildService);
  const schemaResult = await executeSchema(buildService);
  const indexingResult = await executeIndexingFunctions(buildService);
  const apiResult = await executeApiRoutes(buildService);

  if (configResult.status === "error") {
    return {
      indexing: { status: "error", error: configResult.error },
      api: { status: "error", error: configResult.error },
    };
  }
  if (schemaResult.status === "error") {
    return {
      indexing: { status: "error", error: schemaResult.error },
      api: { status: "error", error: schemaResult.error },
    };
  }
  if (indexingResult.status === "error") {
    return {
      indexing: { status: "error", error: indexingResult.error },
      api: { status: "error", error: indexingResult.error },
    };
  }
  if (apiResult.status === "error") {
    return {
      indexing: { status: "error", error: apiResult.error },
      api: { status: "error", error: apiResult.error },
    };
  }

  let cachedConfigResult = configResult;
  let cachedSchemaResult = schemaResult;
  let cachedIndexingResult = indexingResult;
  let cachedApiResult = apiResult;

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
      const hasIndexingUpdate = invalidated.some(
        (file) =>
          buildService.indexingRegex.test(file) &&
          !buildService.apiRegex.test(file),
      );
      const hasApiUpdate = invalidated.some((file) =>
        buildService.apiRegex.test(file),
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
        msg: `Hot reload ${invalidated
          .map((f) => `'${path.relative(common.options.rootDir, f)}'`)
          .join(", ")}`,
      });

      if (hasConfigUpdate) {
        const result = await executeConfig(buildService);
        if (result.status === "error") {
          onIndexingBuild({ status: "error", error: result.error });
          return;
        }
        cachedConfigResult = result;
      }

      if (hasSchemaUpdate) {
        const result = await executeSchema(buildService);
        if (result.status === "error") {
          onIndexingBuild({ status: "error", error: result.error });
          return;
        }
        cachedSchemaResult = result;
      }

      if (hasIndexingUpdate) {
        const files = glob.sync(buildService.indexingPattern, {
          ignore: buildService.apiPattern,
        });
        buildService.viteNodeRunner.moduleCache.invalidateDepTree(files);
        buildService.viteNodeRunner.moduleCache.deleteByModuleId("@/generated");

        const result = await executeIndexingFunctions(buildService);
        if (result.status === "error") {
          onIndexingBuild({ status: "error", error: result.error });
          return;
        }
        cachedIndexingResult = result;
      }

      if (hasApiUpdate) {
        const files = glob.sync(buildService.apiPattern);
        buildService.viteNodeRunner.moduleCache.invalidateDepTree(files);
        buildService.viteNodeRunner.moduleCache.deleteByModuleId("@/generated");

        const result = await executeApiRoutes(buildService);
        if (result.status === "error") {
          onApiBuild({ status: "error", error: result.error });
          return;
        }
        cachedApiResult = result;
      }

      /**
       * Build and validate updated indexing and api artifacts
       *
       * There are a few cases to handle:
       * 1) config or schema is updated -> rebuild both api and indexing
       * 2) indexing functions are updated -> rebuild indexing
       * 3) api routes are updated -> rebuild api
       *
       * Note: the api build cannot be successful if the indexing
       * build fails, this means that any indexing errors are always
       * propogated to the api build.
       */

      const indexingBuildResult = await validateAndBuild(
        buildService,
        cachedConfigResult,
        cachedSchemaResult,
        cachedIndexingResult,
      );
      if (indexingBuildResult.status === "error") {
        onIndexingBuild(indexingBuildResult);
        onApiBuild(indexingBuildResult);
        return;
      }

      // If schema or config is updated, rebuild both api and indexing
      if (hasConfigUpdate || hasSchemaUpdate) {
        onIndexingBuild(indexingBuildResult);
        onApiBuild(
          validateAndBuildApi(
            buildService,
            indexingBuildResult.build,
            cachedApiResult,
          ),
        );
      } else {
        if (hasIndexingUpdate) {
          onIndexingBuild(indexingBuildResult);
        }

        if (hasApiUpdate) {
          onApiBuild(
            validateAndBuildApi(
              buildService,
              indexingBuildResult.build,
              cachedApiResult,
            ),
          );
        }
      }
    };

    buildService.viteDevServer.watcher.on("change", onFileChange);
  }

  // Build and validate initial indexing and server build.
  // Note: the api build cannot be successful if the indexing
  // build fails

  const initialBuildResult = await validateAndBuild(
    buildService,
    configResult,
    schemaResult,
    indexingResult,
  );

  if (initialBuildResult.status === "error") {
    return {
      indexing: { status: "error", error: initialBuildResult.error },
      api: { status: "error", error: initialBuildResult.error },
    };
  }

  const initialApiBuildResult = validateAndBuildApi(
    buildService,
    initialBuildResult.build,
    apiResult,
  );

  return {
    indexing: initialBuildResult,
    api: initialApiBuildResult,
  };
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
  | { status: "success"; config: Config; contentHash: string }
  | { status: "error"; error: Error }
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

  const contentHash = createHash("sha256")
    .update(JSON.stringify(config))
    .digest("hex");

  return { status: "success", config, contentHash } as const;
};

const executeSchema = async (
  buildService: Service,
): Promise<
  | { status: "success"; schema: Schema; contentHash: string }
  | { status: "error"; error: Error }
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

  const contentHash = createHash("sha256")
    .update(JSON.stringify(schema))
    .digest("hex");

  return { status: "success", schema, contentHash };
};

const executeIndexingFunctions = async (
  buildService: Service,
): Promise<
  | {
      status: "success";
      indexingFunctions: RawIndexingFunctions;
      contentHash: string;
    }
  | { status: "error"; error: Error }
> => {
  const files = glob.sync(buildService.indexingPattern, {
    ignore: buildService.apiPattern,
  });
  const executeResults = await Promise.all(
    files.map(async (file) => ({
      ...(await executeFile(buildService, { file })),
      file,
    })),
  );

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
  }

  // Note that we are only hashing the file contents, not the exports. This is
  // different from the config/schema, where we include the serializable object itself.
  const hash = createHash("sha256");
  for (const file of files) {
    try {
      const contents = fs.readFileSync(file, "utf-8");
      hash.update(contents);
    } catch (e) {
      buildService.common.logger.warn({
        service: "build",
        msg: `Unable to read contents of file '${file}' while constructin build ID`,
      });
      hash.update(file);
    }
  }
  const contentHash = hash.digest("hex");

  const exports = await buildService.viteNodeRunner.executeId("@/generated");

  return {
    status: "success",
    indexingFunctions: exports.ponder.fns,
    contentHash,
  };
};

const executeApiRoutes = async (
  buildService: Service,
): Promise<
  | {
      status: "success";
      app: Hono;
      routes: PonderRoutes;
    }
  | { status: "error"; error: Error }
> => {
  const files = glob.sync(buildService.apiPattern);
  const executeResults = await Promise.all(
    files.map(async (file) => ({
      ...(await executeFile(buildService, { file })),
      file,
    })),
  );

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
  }

  const exports = await buildService.viteNodeRunner.executeId("@/generated");

  return {
    status: "success",
    app: exports.ponder.hono,
    routes: exports.ponder.routes,
  };
};

const validateAndBuild = async (
  { common }: Pick<Service, "common">,
  config: { config: Config; contentHash: string },
  schema: { schema: Schema; contentHash: string },
  indexingFunctions: {
    indexingFunctions: RawIndexingFunctions;
    contentHash: string;
  },
): Promise<IndexingBuildResult> => {
  // Validate and build the schema
  const buildSchemaResult = safeBuildSchema({
    schema: schema.schema,
  });
  if (buildSchemaResult.status === "error") {
    common.logger.error({
      service: "build",
      msg: "Error while building schema:",
      error: buildSchemaResult.error,
    });

    return buildSchemaResult;
  }

  for (const log of buildSchemaResult.logs) {
    common.logger[log.level]({ service: "build", msg: log.msg });
  }

  const graphqlSchema = buildGraphQLSchema(buildSchemaResult.schema);

  // Validates and build the config
  const buildConfigAndIndexingFunctionsResult =
    await safeBuildConfigAndIndexingFunctions({
      config: config.config,
      rawIndexingFunctions: indexingFunctions.indexingFunctions,
      options: common.options,
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

  const buildId = createHash("sha256")
    .update(BUILD_ID_VERSION)
    .update(config.contentHash)
    .update(schema.contentHash)
    .update(indexingFunctions.contentHash)
    .digest("hex")
    .slice(0, 10);

  common.logger.debug({
    service: "build",
    msg: `Completed build with ID '${buildId}' (hash of project file contents)`,
  });

  return {
    status: "success",
    build: {
      buildId,
      databaseConfig: buildConfigAndIndexingFunctionsResult.databaseConfig,
      optionsConfig: buildConfigAndIndexingFunctionsResult.optionsConfig,
      networks: buildConfigAndIndexingFunctionsResult.networks,
      sources: buildConfigAndIndexingFunctionsResult.sources,
      schema: buildSchemaResult.schema,
      graphqlSchema,
      indexingFunctions:
        buildConfigAndIndexingFunctionsResult.indexingFunctions,
    },
  };
};

const validateAndBuildApi = (
  { common }: Pick<Service, "common">,
  baseBuild: BaseBuild,
  api: { app: Hono; routes: PonderRoutes },
): ApiBuildResult => {
  for (const {
    pathOrHandlers: [maybePathOrHandler],
  } of api.routes) {
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
        common.logger.error({ service: "build", msg: "Failed build", error });
        return { status: "error", error } as const;
      }
    }
  }

  return {
    status: "success",
    build: {
      ...baseBuild,
      app: api.app,
      routes: api.routes,
    },
  };
};

const executeFile = async (
  { common, viteNodeRunner }: Service,
  { file }: { file: string },
): Promise<
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
