import path from "node:path";
import { safeBuildSchema } from "@/build/schema/schema.js";
import type { Common } from "@/common/common.js";
import type { Config } from "@/config/config.js";
import type { DatabaseConfig } from "@/config/database.js";
import type { Network } from "@/config/networks.js";
import type { Source } from "@/config/sources.js";
import type { Schema } from "@/schema/types.js";
import { buildGqlSchema } from "@/server/graphql/schema.js";
import { Emittery } from "@/utils/emittery.js";
import { glob } from "glob";
import { GraphQLSchema } from "graphql";
import { type ViteDevServer, createServer } from "vite";
import { ViteNodeRunner } from "vite-node/client";
import { ViteNodeServer } from "vite-node/server";
import { installSourcemapsSupport } from "vite-node/source-map";
import { normalizeModuleId, toFilePath } from "vite-node/utils";
import viteTsconfigPathsPlugin from "vite-tsconfig-paths";
import { safeBuildConfig } from "./config/config.js";
import {
  type IndexingFunctions,
  type RawIndexingFunctions,
  safeBuildIndexingFunctions,
} from "./functions/functions.js";
import { vitePluginPonder } from "./plugin.js";
import type { ViteNodeError } from "./stacktrace.js";
import { parseViteNodeError } from "./stacktrace.js";
import {
  type FunctionIds,
  type TableIds,
  safeGetFunctionAndTableIds,
} from "./static/getFunctionAndTableIds.js";
import {
  type TableAccess,
  safeGetTableAccess,
} from "./static/getTableAccess.js";

export type Build = {
  // Config
  databaseConfig: DatabaseConfig;
  sources: Source[];
  networks: Network[];
  // Schema
  schema: Schema;
  graphqlSchema: GraphQLSchema;
  // Indexing functions
  indexingFunctions: IndexingFunctions;
  // Static analysis
  tableAccess: TableAccess;
  tableIds: TableIds;
  functionIds: FunctionIds;
};

export type BuildResult =
  | { success: true; build: Build }
  | { success: false; error: Error };

type BuildServiceEvents = {
  rebuild: BuildResult;
};

export class BuildService extends Emittery<BuildServiceEvents> {
  private common: Common;
  private indexingFunctionRegex: RegExp;

  private viteDevServer: ViteDevServer = undefined!;
  private viteNodeServer: ViteNodeServer = undefined!;
  private viteNodeRunner: ViteNodeRunner = undefined!;

  private rawIndexingFunctions: RawIndexingFunctions = {};

  // Maintain the latest version of built user code to support validation.
  // Note that `networks` and `schema` are not currently needed for validation.
  private databaseConfig?: DatabaseConfig;
  private networks?: Network[];
  private sources?: Source[];
  private schema?: Schema;
  private graphqlSchema?: GraphQLSchema;
  private indexingFunctions?: IndexingFunctions;
  private tableAccess?: TableAccess;
  private tableIds?: TableIds;
  private functionIds?: FunctionIds;

  constructor({ common }: { common: Common }) {
    super();
    this.common = common;
    this.indexingFunctionRegex = new RegExp(
      `^${this.common.options.srcDir.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      )}/.*\\.(js|ts)$`,
    );
  }

  async setup({ watch }: { watch: boolean }) {
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
      plugins: [viteTsconfigPathsPlugin(), vitePluginPonder()],
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

    // If watch is false (`ponder start` or `ponder serve`),
    // don't register  any event handlers on the watcher.
    if (watch === false) return;

    // Define the directories and files to ignore
    const ignoredDirs = [
      this.common.options.generatedDir,
      this.common.options.ponderDir,
    ];
    const ignoredFiles = [
      path.join(this.common.options.rootDir, "ponder-env.d.ts"),
      path.join(this.common.options.rootDir, ".env.local"),
    ];

    const isFileIgnored = (filePath: string) => {
      const isInIgnoredDir = ignoredDirs.some((dir) => {
        const rel = path.relative(dir, filePath);
        return !rel.startsWith("..") && !path.isAbsolute(rel);
      });

      const isIgnoredFile = ignoredFiles.includes(filePath);
      return isInIgnoredDir || isIgnoredFile;
    };

    const onFileChange = async (files_: string[]) => {
      const files = files_
        .filter((file) => !isFileIgnored(file))
        .map(
          (file) =>
            toFilePath(normalizeModuleId(file), this.common.options.rootDir)
              .path,
        );

      // Invalidate all modules that depend on the updated files.
      const invalidated = [
        ...this.viteNodeRunner.moduleCache.invalidateDepTree(files),
      ];

      // If no files were invalidated, no need to reload.
      if (invalidated.length === 0) return;

      this.common.logger.info({
        service: "build",
        msg: `Hot reload ${invalidated
          .map((f) => `'${path.relative(this.common.options.rootDir, f)}'`)
          .join(", ")}`,
      });

      if (invalidated.includes(this.common.options.configFile)) {
        const configResult = await this.loadConfig();
        const validationResult = this.validate();
        const analyzeResult = this.analyze();

        const error =
          configResult.error ?? validationResult.error ?? analyzeResult.error;

        if (error) {
          this.common.logger.error({ service: "build", error });
          this.emit("rebuild", { success: false, error });
          return;
        }
      }

      if (invalidated.includes(this.common.options.schemaFile)) {
        const schemaResult = await this.loadSchema();
        const validationResult = this.validate();
        const analyzeResult = this.analyze();

        const error =
          schemaResult.error ?? validationResult.error ?? analyzeResult.error;

        if (error) {
          this.common.logger.error({ service: "build", error });
          this.emit("rebuild", { success: false, error });
          return;
        }
      }

      const indexingFunctionFiles = invalidated.filter((file) =>
        this.indexingFunctionRegex.test(file),
      );
      if (indexingFunctionFiles.length > 0) {
        const indexingFunctionsResult = await this.loadIndexingFunctions({
          files: indexingFunctionFiles,
        });
        const validationResult = this.validate();
        const parseResult = this.parse();
        const analyzeResult = this.analyze();

        const error =
          indexingFunctionsResult.error ??
          validationResult.error ??
          parseResult.error ??
          analyzeResult.error;

        if (error) {
          this.common.logger.error({ service: "build", error });
          this.emit("rebuild", { success: false, error });
          return;
        }
      }

      this.emit("rebuild", {
        success: true,
        build: {
          databaseConfig: this.databaseConfig!,
          sources: this.sources!,
          networks: this.networks!,
          schema: this.schema!,
          graphqlSchema: this.graphqlSchema!,
          indexingFunctions: this.indexingFunctions!,
          tableAccess: this.tableAccess!,
          tableIds: this.tableIds!,
          functionIds: this.functionIds!,
        },
      });
    };

    this.viteDevServer.watcher.on("change", async (file) => {
      await onFileChange([file]);
    });
  }

  async kill() {
    this.cancelMutexes();
    await this.viteDevServer?.close();
    this.common.logger.debug({
      service: "build",
      msg: "Killed build service",
    });
  }

  async initialLoad() {
    const configResult = await this.loadConfig();
    if (!configResult.success) return { error: configResult.error } as const;

    const schemaResult = await this.loadSchema();
    if (!schemaResult.success) return { error: schemaResult.error } as const;

    const files = glob.sync(
      path.join(this.common.options.srcDir, "**/*.{js,mjs,ts,mts}"),
    );
    const indexingFunctionsResult = await this.loadIndexingFunctions({ files });
    if (!indexingFunctionsResult.success)
      return { error: indexingFunctionsResult.error } as const;

    const validationResult = this.validate();
    if (validationResult.error)
      return { error: validationResult.error } as const;
    const parseResult = this.parse();
    if (parseResult.error) return { error: parseResult.error } as const;
    const analyzeResult = this.analyze();
    if (analyzeResult.error) return { error: analyzeResult.error } as const;

    const { databaseConfig, sources, networks } = configResult;
    const { schema, graphqlSchema } = schemaResult;
    const { indexingFunctions } = indexingFunctionsResult;
    const { tableAccess } = parseResult;
    const { tableIds, functionIds } = analyzeResult;

    return {
      success: true,
      build: {
        databaseConfig,
        networks,
        sources,
        schema,
        graphqlSchema,
        indexingFunctions,
        tableAccess,
        tableIds,
        functionIds,
      },
    } satisfies BuildResult;
  }

  async loadConfig() {
    const loadResult = await this.executeFile(this.common.options.configFile);
    if (!loadResult.success) {
      return { success: false, error: loadResult.error } as const;
    }

    const rawConfig = loadResult.exports.default as Config;
    const buildResult = await safeBuildConfig({
      config: rawConfig,
      options: this.common.options,
    });

    if (buildResult.error) {
      return { success: false, error: buildResult.error } as const;
    }

    for (const log of buildResult.data.logs) {
      this.common.logger[log.level]({ service: "build", msg: log.msg });
    }

    const { databaseConfig, sources, networks } = buildResult.data;
    this.databaseConfig = databaseConfig;
    this.networks = networks;
    this.sources = sources;

    return { success: true, databaseConfig, sources, networks } as const;
  }

  async loadSchema() {
    const loadResult = await this.executeFile(this.common.options.schemaFile);
    if (loadResult.error) {
      return { success: false, error: loadResult.error } as const;
    }

    const rawSchema = loadResult.exports.default as Schema;

    const buildResult = safeBuildSchema({ schema: rawSchema });
    if (buildResult.error) {
      return { success: false, error: buildResult.error } as const;
    }

    const schema = buildResult.data.schema;
    this.schema = schema;

    // TODO: Probably move this elsewhere. Also, handle errors.
    const graphqlSchema = buildGqlSchema(buildResult.data.schema);
    this.graphqlSchema = graphqlSchema;

    return { success: true, schema, graphqlSchema } as const;
  }

  async loadIndexingFunctions({ files }: { files: string[] }) {
    const rawLoadResults = await Promise.all(
      files.map((file) => this.executeFile(file)),
    );
    const loadResultErrors = rawLoadResults.filter(
      (r): r is { success: false; error: ViteNodeError } => !r.success,
    );
    const loadResults = rawLoadResults.filter(
      (r): r is { success: true; file: string; exports: any } => r.success,
    );

    if (loadResultErrors.length > 0) {
      return { success: false, error: loadResultErrors[0].error } as const;
    }

    for (const result of loadResults) {
      const { file, exports } = result;
      const fns = (exports?.ponder?.fns ?? []) as { name: string; fn: any }[];
      (this.rawIndexingFunctions || {})[file] = fns;
    }

    const buildResult = safeBuildIndexingFunctions({
      rawIndexingFunctions: this.rawIndexingFunctions,
    });
    if (!buildResult.success) {
      return { success: false, error: buildResult.error } as const;
    }

    for (const warning of buildResult.data.warnings) {
      this.common.logger.warn({ service: "build", msg: warning });
    }

    const indexingFunctions = buildResult.data.indexingFunctions;
    this.indexingFunctions = indexingFunctions;

    return { success: true, indexingFunctions } as const;
  }

  /**
   * Validates and builds the latest config, schema, and indexing functions.
   * Returns an error if validation fails.
   */
  private validate() {
    if (!this.sources || !this.indexingFunctions)
      return { success: true } as const;

    for (const [sourceName, fns] of Object.entries(this.indexingFunctions)) {
      for (const eventName of Object.keys(fns)) {
        const eventKey = `${sourceName}:${eventName}`;

        const source = this.sources.find((s) => s.contractName === sourceName);
        if (!source) {
          // Multi-network contracts have N sources, but the hint here should not have duplicates.
          const uniqueContractNames = [
            ...new Set(this.sources.map((s) => s.contractName)),
          ];
          const error = new Error(
            `Validation failed: Invalid contract name for event '${eventKey}'. Got '${sourceName}', expected one of [${uniqueContractNames
              .map((n) => `'${n}'`)
              .join(", ")}].`,
          );
          error.stack = undefined;
          return { success: false, error } as const;
        }

        const eventNames = [
          ...Object.keys(source.abiEvents.bySafeName),
          "setup",
        ];
        if (!eventNames.find((e) => e === eventName)) {
          const error = new Error(
            `Validation failed: Invalid event name for event '${eventKey}'. Got '${eventName}', expected one of [${eventNames
              .map((eventName) => `'${eventName}'`)
              .join(", ")}].`,
          );
          error.stack = undefined;
          return { success: false, error } as const;
        }
      }
    }

    return { success: true } as const;
  }

  private parse() {
    if (!this.rawIndexingFunctions || !this.schema || !this.sources)
      return {
        success: false,
        error: new Error(
          "Invariant violation: BuildService.parse() called before config, schema, or indexing functions were built.",
        ),
      } as const;

    const tableNames = Object.keys(this.schema.tables);
    const filePaths = Object.keys(this.rawIndexingFunctions);

    const result = safeGetTableAccess({ tableNames, filePaths });
    if (!result.success) {
      return { success: false, error: result.error } as const;
    }

    this.tableAccess = result.data;

    return { success: true, tableAccess: result.data } as const;
  }

  private analyze() {
    if (
      !this.tableAccess ||
      !this.schema ||
      !this.sources ||
      !this.indexingFunctions
    )
      return {
        success: false,
        error: new Error(
          "Invariant violation: BuildService.analyze() called before config, schema, or indexing functions were built.",
        ),
      } as const;

    const result = safeGetFunctionAndTableIds({
      sources: this.sources,
      tableAccess: this.tableAccess,
      schema: this.schema,
      indexingFunctions: this.indexingFunctions,
    });
    if (!result.success) {
      return { success: false, error: result.error } as const;
    }

    this.tableIds = result.data.tableIds;
    this.functionIds = result.data.functionIds;

    return { success: true, ...result.data } as const;
  }

  private async executeFile(file: string) {
    try {
      const exports = await this.viteNodeRunner.executeFile(file);
      return { success: true, file, exports } as const;
    } catch (error_) {
      const relativePath = path.relative(this.common.options.rootDir, file);
      const error = parseViteNodeError(relativePath, error_ as Error);
      return { success: false, error } as const;
    }
  }
}
