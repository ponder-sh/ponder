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

import type { Factory } from "@/config/factories";
import type { LogFilter } from "@/config/logFilters";
import type { ResolvedConfig } from "@/config/types";
import { UserError } from "@/errors/user";
import type { Common } from "@/Ponder";
import { buildSchema } from "@/schema/schema";
import type { Schema } from "@/schema/types";
import { buildGqlSchema } from "@/server/graphql/schema";

import {
  type HandlerFunctions,
  hydrateHandlerFunctions,
  RawHandlerFunctions,
} from "./handlers";
import { readGraphqlSchema } from "./schema";
import { createHotContext, handleMessage } from "./vite-node-hmr";

type BuildServiceEvents = {
  newConfig: { config: ResolvedConfig };
  newHandlers: { handlers: HandlerFunctions };
  newSchema: { schema: Schema; graphqlSchema: GraphQLSchema };
};

// const consoleLog = globalThis.console.log;
// globalThis.console = {
//   ...globalThis.console,
//   log(...args: any[]) {
//     if (
//       typeof args[0] === "string" &&
//       args[0].startsWith("\x1b[36m[vite-node]\x1b[39m hot updated:")
//     )
//       return;
//     consoleLog("in wrapper with", args);
//     consoleLog(...args);
//   },
// };

export class BuildService extends Emittery<BuildServiceEvents> {
  private common: Common;
  private logFilters: LogFilter[];
  private factories: Factory[];

  private srcRegex: RegExp;

  private viteDevServer: ViteDevServer = undefined!;
  private viteNodeServer: ViteNodeServer = undefined!;
  private viteNodeRunner: ViteNodeRunner = undefined!;

  private indexingFunctions: Record<string, Record<string, any>> = {};

  constructor({
    common,
    logFilters,
    factories,
  }: {
    common: Common;
    logFilters: LogFilter[];
    factories: Factory[];
  }) {
    super();
    this.common = common;
    this.logFilters = logFilters;
    this.factories = factories;

    this.srcRegex = new RegExp(
      "^" + this.common.options.srcDir + ".*\\.(js|ts)$"
    );
  }

  async setup() {
    // Monkeypath to suppress `vite-node` update logs.
    const consoleLog = global.console.log;
    global.console.log = (...args) => {
      if (
        typeof args[0] === "string" &&
        args[0].startsWith("\x1B[36m[vite-node]\x1B[39m hot updated:")
      )
        return;
      consoleLog(...args);
    };

    const { createServer } = await import("vite");
    const { ViteNodeServer } = await import("vite-node/server");
    const { installSourcemapsSupport } = await import("vite-node/source-map");
    const { ViteNodeRunner } = await import("vite-node/client");
    const { viteNodeHmrPlugin } = await import("vite-node/hmr");
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
      server: { hmr: true },
      plugins: [
        viteNodeHmrPlugin(),
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

            // Mark every module as self-accepting, but immediately invalidate. This
            // means modules will use the HMR pipeline, but will always be fully reloaded
            // by Vite. In the future, we can implement actual HMR logic.
            const metaHotFooter = `
              if (import.meta.hot) {
                import.meta.hot.accept((newModule) => {
                  import.meta.hot.invalidate();
                })
              }
            `;
            code = `${code}${metaHotFooter}`;

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
      fetchModule: (id) => this.viteNodeServer.fetchModule(id),
      resolveId: (id, importer) => this.viteNodeServer.resolveId(id, importer),
      // Boilerplate for vite-node HMR.
      createHotContext: (runner, url) =>
        createHotContext(runner, this.viteDevServer.emitter, [], url),
    });

    this.viteDevServer.watcher.on("change", (file) => {
      console.log("change ", file);
    });
    this.viteDevServer.watcher.on("add", (file) => {
      console.log("add ", file);
    });
    this.viteDevServer.watcher.on("unlink", (file) => {
      console.log("unlink ", file);
    });

    const handleFileChange = async (files_: string[]) => {
      const opts = this.common.options;

      const files = files_.map(
        (file) => toFilePath(normalizeModuleId(file), opts.rootDir).path
      );

      // Invalidate all modules that depend on the updated files.
      // Note that this fully removes those modules from the moduleCache,
      // this is not idempotent. So, we need to be sure to re-execute all
      // of these invalidated modules immediately.
      const invalidated = [
        ...this.viteNodeRunner.moduleCache.invalidateDepTree(files),
      ];

      this.common.logger.info({
        service: "build",
        msg: `Hot reload ${invalidated
          .map((f) => path.relative(opts.rootDir, f))
          .join(", ")}`,
      });

      // The default vite-node HMR message handler.
      // 1) Removes all user modules from the module cache.
      // 2) Executes the files present in `payload.updates`.
      // 3) For some reason, executed modules are not added back into the cache,
      // which is annoying and means we need to re-execute no matter what.
      await handleMessage(
        this.viteNodeRunner,
        this.viteDevServer.emitter,
        [],
        payload
      );

      // Note that the order execution here is intentional.
      if (invalidated.includes(opts.configFile)) {
        await this.loadConfig();
      }
      if (invalidated.includes(opts.schemaFile)) {
        await this.loadSchema();
      }

      const srcFiles = invalidated.filter((file) => this.srcRegex.test(file));
      if (srcFiles.length > 0) {
        await this.loadIndexingFunctions({ files: srcFiles });
      }
    };

    this.viteDevServer.emitter.on("message", async (payload) => {
      switch (payload.type) {
        case "update": {
          const opts = this.common.options;

          const files = payload.updates.map(
            (u) => toFilePath(normalizeModuleId(u.path), opts.rootDir).path
          );

          // Invalidate all modules that depend on the updated files.
          // Note that this fully removes those modules from the moduleCache,
          // this is not idempotent. So, we need to be sure to re-execute all
          // of these invalidated modules immediately.
          const invalidated = [
            ...this.viteNodeRunner.moduleCache.invalidateDepTree(files),
          ];

          this.common.logger.info({
            service: "build",
            msg: `Hot reload ${invalidated
              .map((f) => path.relative(opts.rootDir, f))
              .join(", ")}`,
          });

          // The default vite-node HMR message handler.
          // 1) Removes all user modules from the module cache.
          // 2) Executes the files present in `payload.updates`.
          // 3) For some reason, executed modules are not added back into the cache,
          // which is annoying and means we need to re-execute no matter what.
          await handleMessage(
            this.viteNodeRunner,
            this.viteDevServer.emitter,
            [],
            payload
          );

          // Note that the order execution here is intentional.
          if (invalidated.includes(opts.configFile)) {
            await this.loadConfig();
          }
          if (invalidated.includes(opts.schemaFile)) {
            await this.loadSchema();
          }

          const srcFiles = invalidated.filter((file) =>
            this.srcRegex.test(file)
          );
          if (srcFiles.length > 0) {
            await this.loadIndexingFunctions({ files: srcFiles });
          }

          break;
        }
        default: {
          // For events other than "update", just use the provided
          // message handler with no adjustments. Like in the
          // TODO: Consider handling the "full-reload" event manually.
          await handleMessage(
            this.viteNodeRunner,
            this.viteDevServer.emitter,
            [],
            payload
          );

          console.log(`Unhandled Vite HMR event: "${payload.type}"`, payload);
        }
      }
    });

    // Load all the project files once during setup.
    const initialSrcFiles = glob.sync(
      path.join(this.common.options.srcDir, "**/*.{js,cjs,mjs,ts,mts}")
    );

    await Promise.all([
      this.loadConfig(),
      this.loadSchema(),
      this.loadIndexingFunctions({ files: initialSrcFiles }),
    ]);
  }

  async kill() {
    await this.viteDevServer?.close();
    this.common.logger.debug({
      service: "build",
      msg: `Killed build service`,
    });
  }

  async loadConfig() {
    try {
      const module = await this.viteNodeRunner.executeFile(
        this.common.options.configFile
      );
      const rawConfig = module.config;
      const resolvedConfig =
        typeof rawConfig === "function" ? await rawConfig() : await rawConfig;

      // TODO: Validate config lol

      this.emit("newConfig", { config: resolvedConfig });
    } catch (err) {
      console.log("error while loading config", err);
    }
  }

  async loadSchema() {
    console.log("loaded schema ");
  }

  async loadIndexingFunctions({ files }: { files: string[] }) {
    // TODO: Consider handling errors here.
    const results = await Promise.all(
      files.map(async (file) => {
        const exports = await this.viteNodeRunner.executeFile(file);
        return { file, exports };
      })
    );
    // } catch (error_) {
    //   const error = error_ as Error;
    //   console.log("error while loading config", error);

    //   this.common.logger.error({
    //     service: "build",
    //     error,
    //   });
    //   this.common.errors.submitUserError({ error });
    // }

    for (const { file, exports } of results) {
      const fns = (exports?.ponder?.fns ?? []) as { name: string; fn: any }[];

      if (fns.length === 0) {
        const relative = path.relative(this.common.options.rootDir, file);
        this.common.logger.warn({
          service: "build",
          msg: `No indexing functions registered in ${relative}`,
        });
      }

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
    const rawHandlerFunctions: RawHandlerFunctions = { eventSources: {} };
    for (const file of Object.keys(this.indexingFunctions)) {
      for (const [fullName, fn] of Object.entries(
        this.indexingFunctions[file]
      )) {
        if (fullName === "setup") {
          rawHandlerFunctions._meta_ ||= {};
          rawHandlerFunctions._meta_.setup = fn;
        } else {
          const [eventSourceName, eventName] = fullName.split(":");
          if (!eventSourceName || !eventName)
            throw new Error(`Invalid event name: ${fullName}`);
          rawHandlerFunctions.eventSources[eventSourceName] ||= {};
          if (rawHandlerFunctions.eventSources[eventSourceName][eventName])
            throw new Error(
              `Cannot add multiple handler functions for event: ${name}`
            );
          rawHandlerFunctions.eventSources[eventSourceName][eventName] = fn;
        }
      }
    }

    const handlers = hydrateHandlerFunctions({
      rawHandlerFunctions,
      logFilters: this.logFilters,
      factories: this.factories,
    });

    this.emit("newHandlers", { handlers });
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

      // TODO: Build the UserError object within readHandlers, check instanceof,
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
