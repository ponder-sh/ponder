import Emittery from "emittery";
import glob from "glob";
import { GraphQLSchema } from "graphql";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import type { ViteDevServer } from "vite";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import type { ViteNodeRunner } from "vite-node/client";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import type { ViteNodeServer } from "vite-node/server";

import type { Factory } from "@/config/factories";
import type { LogFilter } from "@/config/logFilters";
import { UserError } from "@/errors/user";
import type { Common } from "@/Ponder";
import { buildSchema } from "@/schema/schema";
import type { Schema } from "@/schema/types";
import { buildGqlSchema } from "@/server/graphql/schema";

import {
  type HandlerFunctions,
  type RawHandlerFunctions,
  hydrateHandlerFunctions,
} from "./handlers";
import { readGraphqlSchema } from "./schema";

type BuildServiceEvents = {
  newConfig: undefined;
  newHandlers: { handlers: HandlerFunctions };
  newSchema: { schema: Schema; graphqlSchema: GraphQLSchema };
};

export class BuildService extends Emittery<BuildServiceEvents> {
  private common: Common;
  private logFilters: LogFilter[];
  private factories: Factory[];

  private viteDevServer: ViteDevServer = undefined!;
  private viteNodeServer: ViteNodeServer = undefined!;
  private viteNodeRunner: ViteNodeRunner = undefined!;

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
    const { createServer } = await import("vite");
    const { ViteNodeServer } = await import("vite-node/server");
    const { installSourcemapsSupport } = await import("vite-node/source-map");
    const { ViteNodeRunner } = await import("vite-node/client");
    const { viteNodeHmrPlugin, createHotContext, handleMessage } = await import(
      "vite-node/hmr"
    );

    const projectFiles = [
      this.common.options.configFile,
      ...glob.sync(
        path.join(this.common.options.srcDir, "**/*.{js,cjs,mjs,ts,mts}")
      ),
    ];

    const rootRegex = new RegExp(
      "^" + this.common.options.rootDir + ".*\\.(js|ts)$"
    );
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

    const generatedFile = path.join(
      this.common.options.generatedDir,
      "index.ts"
    );

    this.viteDevServer = await createServer({
      root: this.common.options.rootDir,
      resolve: {
        alias: [{ find: "@/generated", replacement: generatedFile }],
      },
      cacheDir: path.join(this.common.options.ponderDir, "vite"),
      publicDir: false,
      customLogger: viteLogger,
      // TODO: Not sure about these.
      // optimizeDeps: { disabled: true },
      // ssr: { noExternal: true },
      server: { hmr: true },
      plugins: [
        {
          name: "ponder:hmr",
          transform: (code, id) => {
            if (!rootRegex.test(id)) return;
            // Mark every module as self-accepting, but immediately invalidate. This
            // means modules will use the HMR pipeline, but will always be fully reloaded
            // by Vite. In the future, we can implement actual HMR logic.
            const metaHotFooter = `
              if (import.meta.hot) {
                import.meta.hot.accept((newModule) => {
                  import.meta.hot.invalidate();
                })
              }
            `.replace(/(\n|\s\s)+/gm, "");

            return `${code}\n${metaHotFooter}`;
          },
        },
        viteNodeHmrPlugin(),
      ],
    });
    await this.viteDevServer.pluginContainer.buildStart({});

    this.viteNodeServer = new ViteNodeServer(this.viteDevServer);
    installSourcemapsSupport({
      getSourceMap: (source) => this.viteNodeServer.getSourceMap(source),
    });

    this.viteNodeRunner = new ViteNodeRunner({
      root: this.viteDevServer.config.root,
      fetchModule: (id) => this.viteNodeServer.fetchModule(id),
      resolveId: (id, importer) => this.viteNodeServer.resolveId(id, importer),
      // Required for HMR support when using `vite-node`.
      createHotContext: (runner, url) =>
        createHotContext(runner, this.viteDevServer.emitter, projectFiles, url),
    });

    this.viteDevServer.emitter.on("message", async (payload) => {
      let filesToExecute: string[] = [];
      let shouldUpdateConfig = false;
      let shouldUpdateSchema = false;
      let shouldUpdateIndexingFunctions = false;

      switch (payload.type) {
        case "full-reload": {
          // This event (annoyingly) does not include the file path
          // responsible for the full reload. However, the vite dev
          // server does log the path. So, we're extracting it from
          // `viteLogger` and emitting it from the Ponder logger above.
          filesToExecute = projectFiles;
          shouldUpdateConfig = true;
          shouldUpdateSchema = true;
          shouldUpdateIndexingFunctions = true;
          break;
        }
        case "update": {
          for (const update of payload.updates) {
            if (update.type === "css-update") {
              this.common.logger.warn({
                service: "build",
                msg: `Unexpected CSS HMR event at '${update.path}'`,
              });
              return;
            }

            // The update path seems to take one of two forms:
            // 1) Absolute full path (/Users/myname/.../src/SomeFile.ts)
            // 2) Absolute path from project root (/abis/SomeFile.abi.ts)
            // This attempts to find a pretty path that's relative
            // to the project root in both cases (src/File.ts)
            const rootDirPrefix = this.common.options.rootDir.slice(0, 7);
            const prettyPath = update.path.startsWith(rootDirPrefix)
              ? path.relative(this.common.options.rootDir, update.path)
              : update.path.slice(1);

            this.common.logger.info({
              service: "build",
              msg: `Reloaded ${prettyPath}`,
            });

            filesToExecute.push(update.path);
            if (update.path === this.common.options.configFile)
              shouldUpdateConfig = true;
            if (update.path === this.common.options.schemaFile)
              shouldUpdateSchema = true;
            if (srcRegex.test(update.path))
              shouldUpdateIndexingFunctions = true;
          }
          break;
        }
        default: {
          this.common.logger.warn({
            service: "build",
            msg: `Unhandled Vite HMR event '${payload.type}'`,
          });
        }
      }

      // This function invalidates the runner cache, then executes
      // `filesToExecute`. We could implement that logic ourselves,
      // but this function also seems to do some additional HMR stuff.
      await handleMessage(
        this.viteNodeRunner,
        this.viteDevServer.emitter,
        filesToExecute,
        payload
      );

      if (shouldUpdateConfig) {
        await this.buildConfig();
      }

      if (shouldUpdateSchema) {
        this.buildSchema();
      }

      if (shouldUpdateIndexingFunctions) {
        await this.buildIndexingFunctions();
      }
    });
  }

  async kill() {
    await this.viteDevServer?.close();
    this.common.logger.debug({
      service: "build",
      msg: `Killed build service`,
    });
  }

  async buildConfig() {
    const module = await this.viteNodeRunner.executeFile(
      this.common.options.configFile
    );
    const rawConfig = module.config;

    const config =
      typeof rawConfig === "function" ? await rawConfig() : await rawConfig;

    console.log("got new ", { config });
    // this.emit("newConfig", { config });
  }

  async buildIndexingFunctions() {
    try {
      const sourceFiles = glob.sync(
        path.join(this.common.options.srcDir, "*.{js,cjs,mjs,ts,mts,tsx}")
      );
      for (const sourceFile of sourceFiles) {
        await this.viteNodeRunner.executeFile(sourceFile);
      }

      const generatedFile = path.join(
        this.common.options.generatedDir,
        "index.ts"
      );
      const generatedModule = await this.viteNodeRunner.executeFile(
        generatedFile
      );

      const app = generatedModule.ponder;

      console.log("got new ", { ponder: generatedModule.ponder });

      if (!app) throw new Error(`ponder not exported from generated/index.ts`);
      if (!(app.constructor.name === "PonderApp"))
        throw new Error(`exported ponder not instanceof PonderApp`);
      if (app["errors"].length > 0) throw app["errors"][0];
      const rawHandlerFunctions = <RawHandlerFunctions>app["handlerFunctions"];

      const handlers = hydrateHandlerFunctions({
        rawHandlerFunctions,
        logFilters: this.logFilters,
        factories: this.factories,
      });

      if (Object.values(handlers.eventSources).length === 0) {
        this.common.logger.warn({
          service: "build",
          msg: "No event handler functions found",
        });
      }

      this.emit("newHandlers", { handlers });
    } catch (error_) {
      const error = error_ as Error;

      // TODO: Build the UserError object within readHandlers, check instanceof,
      // then log/submit as-is if it's already a UserError.
      const message = `Error while building handlers: ${error.message}`;
      const userError = new UserError(message, {
        stack: error.stack,
      });

      this.common.logger.error({
        service: "build",
        error: userError,
      });
      this.common.errors.submitUserError({ error: userError });
    }
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
