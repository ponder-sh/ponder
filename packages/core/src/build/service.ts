import Emittery from "emittery";
import glob from "glob";
import { GraphQLSchema } from "graphql";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import type { ViteDevServer } from "vite";

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
import { ponderHmrEventWrapperPlugin } from "./hmr-event-wrapper";
import { ponderHmrRuntimePlugin } from "./hmr-runtime";
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

  private viteDevServer: ViteDevServer = undefined!;

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
  }

  async setup() {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const { createServer } = await import("vite");

    const srcRegex = new RegExp(
      "^" + this.common.options.srcDir + ".*\\.(js|ts)$"
    );

    const viteLogger = {
      warnedMessages: new Set<string>(),
      loggedErrors: new WeakSet<Error>(),
      hasWarned: false,
      clearScreen() {},
      hasErrorLogged: (error: Error) => viteLogger.loggedErrors.has(error),
      info: (msg: string) => {
        if (msg.includes("page reload")) {
          const filePath = msg.substring(
            msg.indexOf("\\x1B[2m") + 1,
            msg.lastIndexOf("\\x1B[22m")
          );
          this.common.logger.info({
            service: "build/vite",
            msg: `Hot reload '${filePath}'`,
          });
        }
      },
      warn: (msg: string) => {
        viteLogger.hasWarned = true;
        this.common.logger.debug({ service: "build(vite)", msg });
      },
      warnOnce: (msg: string) => {
        if (viteLogger.warnedMessages.has(msg)) return;
        viteLogger.hasWarned = true;
        this.common.logger.debug({ service: "build(vite)", msg });
        viteLogger.warnedMessages.add(msg);
      },
      error: (msg: string) => {
        viteLogger.hasWarned = true;
        this.common.logger.debug({ service: "build(vite)", msg });
      },
    };

    this.viteDevServer = await createServer({
      root: this.common.options.rootDir,
      cacheDir: path.join(this.common.options.ponderDir, "vite"),
      publicDir: false,
      customLogger: viteLogger,
      server: { hmr: true },
      plugins: [
        ponderHmrEventWrapperPlugin(),
        ponderHmrRuntimePlugin({
          onUpdate: async ({ updates }) => {
            for (const file of updates.map((u) => u.path)) {
              const relative = path.relative(this.common.options.rootDir, file);
              this.common.logger.info({
                service: "build",
                msg: `Hot reload ${relative}`,
              });

              if (file === this.common.options.configFile) {
                await this.loadConfig();
              }

              if (file === this.common.options.schemaFile) {
                await this.loadSchema();
              }

              if (srcRegex.test(file)) {
                await this.loadIndexingFunctions({ files: [file] });
              }
            }
          },
          onFullReload: async () => {
            this.common.logger.warn({
              service: "build/vite",
              msg: `Unexpected full reload`,
            });
          },
        }),
      ],
    });

    // This is Vite boilerplate (initializes the Rollup container).
    await this.viteDevServer.pluginContainer.buildStart({});

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
      const module = await this.viteDevServer.ssrLoadModule(
        this.common.options.configFile
      );
      const config = module.config;
      const resolvedConfig =
        typeof config === "function" ? await config() : await config;

      // TODO: Validate config lol

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
    const files =
      files_ ??
      glob.sync(
        path.join(this.common.options.srcDir, "**/*.{js,cjs,mjs,ts,mts}")
      );

    // TODO: Consider handling errors here.
    const results = await Promise.all(
      files.map(async (file) => {
        return { file, exports: await this.viteDevServer.ssrLoadModule(file) };
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
