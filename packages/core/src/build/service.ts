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

type BuildServiceEvents = {
  newConfig: { config: ResolvedConfig };
  newHandlers: { handlers: HandlerFunctions };
  newSchema: { schema: Schema; graphqlSchema: GraphQLSchema };
};

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
    const { createServer } = await import("vite");
    const { ViteNodeServer } = await import("vite-node/server");
    const { installSourcemapsSupport } = await import("vite-node/source-map");
    const { ViteNodeRunner } = await import("vite-node/client");
    const { viteNodeHmrPlugin, createHotContext, handleMessage } = await import(
      "vite-node/hmr"
    );

    // const viteLogger = {
    //   warnedMessages: new Set<string>(),
    //   loggedErrors: new WeakSet<Error>(),
    //   hasWarned: false,
    //   clearScreen() {},
    //   hasErrorLogged: (error: Error) => viteLogger.loggedErrors.has(error),
    //   info: (msg: string) => {
    //     console.log(msg);
    //     // if (msg.includes("page reload")) {
    //     //   const filePath = msg.substring(
    //     //     msg.indexOf("\\x1B[2m") + 1,
    //     //     msg.lastIndexOf("\\x1B[22m")
    //     //   );
    //     //   this.common.logger.info({
    //     //     service: "build/vite",
    //     //     msg: `Hot reload '${filePath}'`,
    //     //   });
    //     // }
    //   },
    //   warn: (msg: string) => {
    //     viteLogger.hasWarned = true;
    //     this.common.logger.debug({ service: "build(vite)", msg });
    //   },
    //   warnOnce: (msg: string) => {
    //     if (viteLogger.warnedMessages.has(msg)) return;
    //     viteLogger.hasWarned = true;
    //     this.common.logger.debug({ service: "build(vite)", msg });
    //     viteLogger.warnedMessages.add(msg);
    //   },
    //   error: (msg: string) => {
    //     viteLogger.hasWarned = true;
    //     this.common.logger.debug({ service: "build(vite)", msg });
    //   },
    // };

    this.viteDevServer = await createServer({
      root: this.common.options.rootDir,
      cacheDir: path.join(this.common.options.ponderDir, "vite"),
      publicDir: false,
      // customLogger: viteLogger,
      clearScreen: false,
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

    // The vite-node HMR implementation assumes you have a static list
    // of files that should ALL be reloaded on every update.
    // Instead, we pass an empty list, and handle the updates manually.
    const files: string[] = [];

    this.viteNodeRunner = new ViteNodeRunner({
      root: this.viteDevServer.config.root,
      fetchModule: (id) => this.viteNodeServer.fetchModule(id),
      resolveId: (id, importer) => this.viteNodeServer.resolveId(id, importer),
      // Boilerplate for vite-node HMR.
      createHotContext: (runner, url) =>
        createHotContext(runner, this.viteDevServer.emitter, files, url),
    });

    this.viteDevServer.emitter.on("message", async (payload) => {
      // Boilerplate for vite-node HMR.
      await handleMessage(
        this.viteNodeRunner,
        this.viteDevServer.emitter,
        files,
        payload
      );

      switch (payload.type) {
        case "full-reload": {
          console.log("TODO");
          break;
        }
        case "update": {
          const files = payload.updates.map((u) => u.path);

          console.log(files);

          const includesConfig = files.includes(this.common.options.configFile);
          const includesSchema = files.includes(this.common.options.schemaFile);
          const srcFiles = files.filter((f) => this.srcRegex.test(f));

          const opts = this.common.options;
          const filesToLog = [];
          if (includesConfig)
            filesToLog.push(path.relative(opts.rootDir, opts.configFile));
          if (includesSchema)
            filesToLog.push(path.relative(opts.rootDir, opts.schemaFile));
          srcFiles.forEach((file) => {
            filesToLog.push(path.relative(opts.rootDir, file));
          });

          this.common.logger.info({
            service: "build",
            msg: `Hot reload ${filesToLog.join(", ")}`,
          });

          if (includesConfig) {
            await this.loadConfig();
          }

          if (includesSchema) {
            await this.loadConfig();
          }

          if (srcFiles.length > 0) {
            await this.loadIndexingFunctions({ files: srcFiles });
          }

          break;
        }
        default: {
          console.log(`Unhandled Vite HMR event: "${payload.type}"`);
        }
      }
    });

    // Load all the project files once during setup.
    await Promise.all([
      this.loadConfig(),
      this.loadSchema(),
      this.loadIndexingFunctions(),
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
      // CONFIG
      const module = await this.viteNodeRunner.executeFile(
        this.common.options.configFile
      );
      const rawConfig = module.config;
      const resolvedConfig =
        typeof rawConfig === "function" ? await rawConfig() : await rawConfig;

      // TODO: Validate config lol
      console.log({ resolvedConfig });

      this.emit("newConfig", { config: resolvedConfig });
    } catch (err) {
      console.log("error while loading config", err);
    }
  }

  async loadSchema() {
    console.log("loaded schema hehe");
  }

  async loadIndexingFunctions({ files: files_ }: { files?: string[] } = {}) {
    // If no `files` argument is provided, load all indexing function files.
    const files = files_ ?? this.getIndexingFunctionFiles();

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

  private getIndexingFunctionFiles() {
    return glob.sync(
      path.join(this.common.options.srcDir, "**/*.{js,cjs,mjs,ts,mts}")
    );
  }
}
