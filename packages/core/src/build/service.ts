/* eslint-disable @typescript-eslint/ban-ts-comment */
import path from "node:path";

import Emittery from "emittery";
import { glob } from "glob";
import type { GraphQLSchema } from "graphql";
import { createServer, type ViteDevServer } from "vite";
import { ViteNodeRunner } from "vite-node/client";
import { ViteNodeServer } from "vite-node/server";
import { installSourcemapsSupport } from "vite-node/source-map";
import { normalizeModuleId, toFilePath } from "vite-node/utils";

import type { Config } from "@/config/config.js";
import type { Common } from "@/Ponder.js";
import type { Schema } from "@/schema/types.js";
import { buildGqlSchema } from "@/server/graphql/schema.js";

import {
  type IndexingFunctions,
  validateIndexingFunctions,
} from "./functions.js";
import { vitePluginPonder } from "./plugin.js";
import type { ViteNodeError } from "./stacktrace.js";
import { parseViteNodeError } from "./stacktrace.js";

type BuildServiceEvents = {
  newConfig: { config: Config };
  newIndexingFunctions: { indexingFunctions: IndexingFunctions };
  newSchema: { schema: Schema; graphqlSchema: GraphQLSchema };
};

export class BuildService extends Emittery<BuildServiceEvents> {
  private common: Common;

  private viteDevServer: ViteDevServer = undefined!;
  private viteNodeServer: ViteNodeServer = undefined!;
  private viteNodeRunner: ViteNodeRunner = undefined!;

  // Mapping of file name -> event name -> function.
  private indexingFunctions: {
    [fileName: string]: { [eventName: string]: (...args: any) => any };
  } = {};

  constructor({ common }: { common: Common }) {
    super();
    this.common = common;
  }

  async setup() {
    const viteLogger = {
      warnedMessages: new Set<string>(),
      loggedErrors: new WeakSet<Error>(),
      hasWarned: false,
      clearScreen() {},
      hasErrorLogged: (error: Error) => viteLogger.loggedErrors.has(error),
      info: (msg: string) => {
        this.common.logger.trace({ service: "build(vite)", msg });
      },
      warn: (msg: string) => {
        viteLogger.hasWarned = true;
        this.common.logger.trace({ service: "build(vite)", msg });
      },
      warnOnce: (msg: string) => {
        if (viteLogger.warnedMessages.has(msg)) return;
        viteLogger.hasWarned = true;
        this.common.logger.trace({ service: "build(vite)", msg });
        viteLogger.warnedMessages.add(msg);
      },
      error: (msg: string) => {
        viteLogger.hasWarned = true;
        this.common.logger.trace({ service: "build(vite)", msg });
      },
    };

    this.viteDevServer = await createServer({
      root: this.common.options.rootDir,
      cacheDir: path.join(this.common.options.ponderDir, "vite"),
      publicDir: false,
      customLogger: viteLogger,
      server: { hmr: false },
      plugins: [vitePluginPonder()],
    });

    // This is Vite boilerplate (initializes the Rollup container).
    await this.viteDevServer.pluginContainer.buildStart({});

    this.viteNodeServer = new ViteNodeServer(this.viteDevServer);
    installSourcemapsSupport({
      getSourceMap: (source) => this.viteNodeServer.getSourceMap(source),
    });

    this.viteNodeRunner = new ViteNodeRunner({
      root: this.viteDevServer.config.root,
      fetchModule: (id) => this.viteNodeServer.fetchModule(id, "ssr"),
      resolveId: (id, importer) =>
        this.viteNodeServer.resolveId(id, importer, "ssr"),
    });

    const handleFileChange = async (files_: string[]) => {
      const files = files_.map(
        (file) =>
          toFilePath(normalizeModuleId(file), this.common.options.rootDir).path,
      );

      // Invalidate all modules that depend on the updated files.
      const invalidated = [
        ...this.viteNodeRunner.moduleCache.invalidateDepTree(files),
      ];

      this.common.logger.info({
        service: "build",
        msg: `Hot reload ${invalidated
          .map((f) => path.relative(this.common.options.rootDir, f))
          .join(", ")}`,
      });

      // Note that the order execution here is intentional.
      if (invalidated.includes(this.common.options.configFile)) {
        await this.loadConfig();
      }
      if (invalidated.includes(this.common.options.schemaFile)) {
        await this.loadSchema();
      }

      const srcRegex = new RegExp(
        `^${this.common.options.srcDir.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        )}/.*\\.(js|ts)$`,
      );
      const srcFiles = invalidated.filter((file) => srcRegex.test(file));

      if (srcFiles.length > 0) {
        await this.loadIndexingFunctions({ files: srcFiles });
      }
    };

    // TODO: Consider handling "add" and "unlink" events too.
    // TODO: Debounce, de-duplicate, and batch updates.

    this.viteDevServer.watcher.on("change", async (file) => {
      const ignoreRegex = new RegExp(
        `^${this.common.options.ponderDir.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        )}/.*[^/]$`,
      );
      if (ignoreRegex.test(file)) return;

      await handleFileChange([file]);
    });
  }

  async kill() {
    await this.viteDevServer?.close();
    this.common.logger.debug({
      service: "build",
      msg: `Killed build service`,
    });
  }

  async loadConfig() {
    const result = await this.executeFile(this.common.options.configFile);
    if (result.error) {
      this.handleViteNodeError(result);
      return;
    }

    const config = result.exports.default as Config;

    // TODO: Validate config lol

    this.emit("newConfig", { config });

    return config;
  }

  async loadSchema() {
    const result = await this.executeFile(this.common.options.schemaFile);
    if (result.error) {
      this.handleViteNodeError(result);
      return;
    }

    const schema = result.exports.default as Schema;
    const graphqlSchema = buildGqlSchema(schema);

    // TODO: Validate schema lol

    this.emit("newSchema", { schema, graphqlSchema });

    return { schema, graphqlSchema };
  }

  async loadIndexingFunctions({ files: files_ }: { files?: string[] } = {}) {
    const files =
      files_ ??
      glob.sync(
        path.join(this.common.options.srcDir, "**/*.{js,cjs,mjs,ts,mts}"),
      );

    const results = await Promise.all(
      files.map((file) => this.executeFile(file)),
    );

    const errorResults = results.filter(
      (r): r is { file: string; error: ViteNodeError } => r.error !== undefined,
    );
    if (errorResults.length > 0) {
      this.handleViteNodeError(errorResults[0]);
      return;
    }

    const successResults = results.filter(
      (r): r is { file: string; exports: any } => r.exports !== undefined,
    );

    for (const result of successResults) {
      const { file, exports } = result;

      const fns = (exports?.ponder?.fns ?? []) as { name: string; fn: any }[];

      const fnsForFile: Record<string, any> = {};
      for (const { name, fn } of fns) fnsForFile[name] = fn;

      // Override the indexing functions for this file.
      this.indexingFunctions[file] = fnsForFile;
    }

    // TODO: validate indexing functions against latest sources.
    const result = validateIndexingFunctions(this.indexingFunctions);
    if (result.error) throw result.error;

    if (Object.keys(result.indexingFunctions).length === 0) {
      this.common.logger.warn({
        service: "build",
        msg: `No indexing functions were registered`,
      });
      return;
    }

    this.emit("newIndexingFunctions", {
      indexingFunctions: result.indexingFunctions,
    });
  }

  private async executeFile(file: string) {
    try {
      const exports = await this.viteNodeRunner.executeFile(file);
      return { file, exports };
    } catch (error_) {
      const error = parseViteNodeError(error_ as Error);
      return { file, error };
    }
  }

  private handleViteNodeError({
    file,
    error,
  }: {
    file: string;
    error: ViteNodeError;
  }) {
    const verb =
      error.name === "ESBuildTransformError"
        ? "transforming"
        : error.name === "ESBuildBuildError" ||
            error.name === "ESBuildContextError"
          ? "building"
          : "executing";

    this.common.logger.error({
      service: "build",
      msg: `Error while ${verb} ${path.relative(
        this.common.options.rootDir,
        file,
      )}`,
      error: error,
    });

    // TODO: Fix this error handling approach.
    this.common.errors.submitUserError();
  }
}
