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
    // const __filename = url.fileURLToPath(import.meta.url);
    const { createServer } = await import("vite");
    const { ViteNodeServer } = await import("vite-node/server");
    const { installSourcemapsSupport } = await import("vite-node/source-map");
    const { ViteNodeRunner } = await import("vite-node/client");

    this.viteDevServer = await createServer({
      root: this.common.options.rootDir,
      resolve: {
        alias: [
          {
            find: "@/generated",
            replacement: this.common.options.generatedDir,
          },
        ],
      },
      cacheDir: path.join(this.common.options.ponderDir, "vite"),
      publicDir: false,
      optimizeDeps: { disabled: true },
      ssr: { noExternal: true },
      clearScreen: false,
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
    });

    this.viteDevServer.watcher.on("all", async (event, filePath) => {
      const relativePath = path.relative(this.common.options.rootDir, filePath);

      // TODO: Should we handle events differently ("change", "add", "unlink", etc)?

      if (filePath === this.common.options.configFile) {
        this.emit("newConfig");
        return;
      }

      if (filePath === this.common.options.schemaFile) {
        this.buildSchema();
        return;
      }

      const srcRegex = new RegExp(
        "^" + this.common.options.srcDir + ".*\\.(js|cjs|mjs|ts|mts|tsx)$"
      );

      if (srcRegex.test(filePath)) {
        this.buildHandlers();
        return;
      }

      this.common.logger.debug({
        service: "build",
        msg: `Detected ${event} in ${relativePath} (no-op)`,
      });
    });
  }

  async kill() {
    await this.viteDevServer?.close();
    this.common.logger.debug({
      service: "build",
      msg: `Killed build service`,
    });
  }

  async buildHandlers() {
    try {
      const generatedFilePath = path.join(
        this.common.options.generatedDir,
        "index.ts"
      );

      // console.log("invalidating all");
      // this.viteDevServer.moduleGraph.invalidateAll();

      console.log("invalidating dep tree");
      const res = this.viteNodeRunner.moduleCache.invalidateDepTree([
        generatedFilePath,
      ]);
      console.log(res);

      const sourceFiles = glob.sync(
        path.join(this.common.options.srcDir, "*.{js,cjs,mjs,ts,mts,tsx}")
      );

      console.log("direct requesting ", sourceFiles);

      for (const sourceFile of sourceFiles) {
        await this.viteNodeRunner.directRequest(sourceFile, sourceFile, []);
      }

      const generatedModule = await this.viteNodeRunner.cachedRequest(
        generatedFilePath,
        generatedFilePath,
        []
      );
      const app = generatedModule.ponder;

      console.log("cached request for generated", app);

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
