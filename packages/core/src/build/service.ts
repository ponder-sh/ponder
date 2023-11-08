/* eslint-disable @typescript-eslint/ban-ts-comment */
import Emittery from "emittery";
import glob from "glob";
import { GraphQLSchema } from "graphql";
import path from "node:path";
// @ts-ignore
import type { ViteDevServer } from "vite";
// @ts-ignore
import type { ViteNodeRunner } from "vite-node/client";
// @ts-ignore
import type { ViteNodeServer } from "vite-node/server";

import type { Config } from "@/config/config";
import { UserError } from "@/errors/user";
import type { Common } from "@/Ponder";
import { buildSchema } from "@/schema/schema";
import type { Schema } from "@/schema/types";
import { buildGqlSchema } from "@/server/graphql/schema";

import type { RawIndexingFunctions } from "./functions";
import { readGraphqlSchema } from "./schema";
import { parseViteNodeError, ViteNodeError } from "./stacktrace";

type BuildServiceEvents = {
  newConfig: { config: Config };
  newIndexingFunctions: { indexingFunctions: RawIndexingFunctions };
  newSchema: { schema: Schema; graphqlSchema: GraphQLSchema };
};

export class BuildService extends Emittery<BuildServiceEvents> {
  private common: Common;

  private viteDevServer: ViteDevServer = undefined!;
  private viteNodeServer: ViteNodeServer = undefined!;
  private viteNodeRunner: ViteNodeRunner = undefined!;

  private indexingFunctions: Record<string, Record<string, any>> = {};

  constructor({ common }: { common: Common }) {
    super();
    this.common = common;
  }

  async setup() {
    const { createServer } = await import("vite");
    const { ViteNodeServer } = await import("vite-node/server");
    const { installSourcemapsSupport } = await import("vite-node/source-map");
    const { ViteNodeRunner } = await import("vite-node/client");
    const { toFilePath, normalizeModuleId } = await import("vite-node/utils");

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
      plugins: [
        {
          name: "ponder:hmr",
          transform: (code_) => {
            let code = code_;

            // Matches `import { ponder } from "@/generated";` with whitespaces and newlines.
            const regex =
              /import\s+\{\s*ponder\s*\}\s+from\s+(['"])@\/generated\1\s*;?/g;
            if (regex.test(code)) {
              // Add shim object to collect user functions.
              const shimHeader = `
                export let ponder = {
                  fns: [],
                  on(name, fn) {
                    this.fns.push({ name, fn });
                  },
                };
              `;
              code = `${shimHeader}\n${code.replace(regex, "")}`;
            }

            return code;
          },
        },
      ],
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
          toFilePath(normalizeModuleId(file), this.common.options.rootDir).path
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
          "\\$&"
        )}/.*\\.(js|ts)$`
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
          "\\$&"
        )}/.*[^/]$`
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

    const rawConfig = result.exports.config;
    const resolvedConfig = (
      typeof rawConfig === "function" ? await rawConfig() : await rawConfig
    ) as Config;

    // TODO: Validate config lol

    this.emit("newConfig", { config: resolvedConfig });

    return resolvedConfig;
  }

  async loadSchema() {
    console.log("loaded schema ");
  }

  async loadIndexingFunctions({ files: files_ }: { files?: string[] } = {}) {
    const files =
      files_ ??
      glob.sync(
        path.join(this.common.options.srcDir, "**/*.{js,cjs,mjs,ts,mts}")
      );

    const results = await Promise.all(
      files.map((file) => this.executeFile(file))
    );

    const errorResults = results.filter(
      (r): r is { file: string; error: ViteNodeError } => r.error !== undefined
    );
    if (errorResults.length > 0) {
      this.handleViteNodeError(errorResults[0]);
      return;
    }

    const successResults = results.filter(
      (r): r is { file: string; exports: any } => r.exports !== undefined
    );

    for (const result of successResults) {
      const { file, exports } = result;

      const fns = (exports?.ponder?.fns ?? []) as { name: string; fn: any }[];

      const fnsForFile: Record<string, any> = {};
      for (const { name, fn } of fns) fnsForFile[name] = fn;

      // Override the indexing functions for this file.
      this.indexingFunctions[file] = fnsForFile;
    }

    // After adding all new indexing functions, validate that the user
    // has not registered two functions for the same event.
    const eventNameSet = new Set<string>();
    for (const file of Object.keys(this.indexingFunctions)) {
      for (const eventName of Object.keys(this.indexingFunctions[file])) {
        if (eventNameSet.has(eventName)) {
          throw new Error(
            `Cannot register two indexing functions for one event '${eventName}' in '${file}'`
          );
        }
        eventNameSet.add(eventName);
      }
    }

    if (eventNameSet.size === 0) {
      this.common.logger.warn({
        service: "build",
        msg: `No indexing functions were registered`,
      });
      return;
    }

    // TODO: Update this to be less awful.
    const rawIndexingFunctions: RawIndexingFunctions = { eventSources: {} };
    for (const file of Object.keys(this.indexingFunctions)) {
      for (const [fullName, fn] of Object.entries(
        this.indexingFunctions[file]
      )) {
        if (fullName === "setup") {
          rawIndexingFunctions._meta_ ||= {};
          rawIndexingFunctions._meta_.setup = fn;
        } else {
          const [eventSourceName, eventName] = fullName.split(":");
          if (!eventSourceName || !eventName)
            throw new Error(`Invalid event name: ${fullName}`);
          rawIndexingFunctions.eventSources[eventSourceName] ||= {};
          if (rawIndexingFunctions.eventSources[eventSourceName][eventName])
            throw new Error(
              `Cannot add multiple handler functions for event: ${name}`
            );
          rawIndexingFunctions.eventSources[eventSourceName][eventName] = fn;
        }
      }
    }

    this.emit("newIndexingFunctions", {
      indexingFunctions: rawIndexingFunctions,
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
        file
      )}`,
      error: error,
    });

    // TODO: Fix this error handling approach.
    this.common.errors.submitUserError({ error });
  }

  buildSchema() {
    try {
      const userGraphqlSchema = readGraphqlSchema({
        options: this.common.options,
      });
      const schema = buildSchema(userGraphqlSchema);
      const graphqlSchema = buildGqlSchema(schema);
      this.emit("newSchema", { schema, graphqlSchema });
      return { schema, graphqlSchema };
    } catch (error_) {
      const error = error_ as Error;

      // TODO: Parse GraphQLError instances better here.
      // We can use the `.locations` property to build a pretty codeframe.

      // TODO: Build the UserError object within readIndexingFunctions, check instanceof,
      // then log/submit as-is if it's already a UserError.
      const message = `Error while building schema.graphql: ${error.message}`;
      const userError = new UserError(message, {
        stack: error.stack,
      });

      this.common.logger.error({
        service: "build",
        error: userError,
      });
      this.common.errors.submitUserError({ error: userError });
      return undefined;
    }
  }
}
