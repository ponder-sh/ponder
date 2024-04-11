import path from "node:path";
import type { Common } from "@/common/common.js";
import type { DatabaseConfig } from "@/config/database.js";
import type { Network } from "@/config/networks.js";
import type { Source } from "@/config/sources.js";
import type { Schema } from "@/schema/types.js";
import type { GraphQLSchema } from "graphql";
import { type ViteDevServer, createServer } from "vite";
import { ViteNodeRunner } from "vite-node/client";
import { ViteNodeServer } from "vite-node/server";
import { installSourcemapsSupport } from "vite-node/source-map";
import viteTsconfigPathsPlugin from "vite-tsconfig-paths";
import type { IndexingFunctions } from "./functions/functions.js";
import { vitePluginPonder } from "./plugin.js";
import { parseViteNodeError } from "./stacktrace.js";

export type BuildService = {
  // static
  common: Common;
  indexingFunctionRegex: RegExp;

  // vite
  viteDevServer: ViteDevServer;
  viteNodeServer: ViteNodeServer;
  viteNodeRunner: ViteNodeRunner;

  // state
  isKilled: boolean;
};

export type Build = {
  // Build ID for caching
  buildId: string;

  // Config
  databaseConfig: DatabaseConfig;
  sources: Source[];
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

export const createBuildService = async ({
  common,
  watch,
}: { common: Common; watch: boolean }): Promise<BuildService> => {
  const indexingFunctionRegex = new RegExp(
    `^${common.options.srcDir.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    )}/.*\\.(js|ts)$`,
  );

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
    indexingFunctionRegex,
    viteDevServer,
    viteNodeServer,
    viteNodeRunner,
    isKilled: false,
  };
};

/**
 * 1) Execute raw indexing functions, schema, and config.
 * 2) Validate raw inputs.
 * 3) Transform raw inputs into the proper format for the rest of the program.
 */
export const build = async (
  buildService: BuildService,
): Promise<BuildResult> => {
  executeFile;
};

export const killBuildService = async (
  buildService: BuildService,
): Promise<void> => {
  buildService.isKilled = true;
};

const executeFile = async (
  { common, viteNodeRunner }: BuildService,
  { file }: { file: string },
) => {
  try {
    const exports = await viteNodeRunner.executeFile(file);
    return { success: true, file, exports } as const;
  } catch (error_) {
    const relativePath = path.relative(common.options.rootDir, file);
    const error = parseViteNodeError(relativePath, error_ as Error);
    return { success: false, error } as const;
  }
};
