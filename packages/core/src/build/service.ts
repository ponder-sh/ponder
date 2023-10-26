import chokidar from "chokidar";
import Emittery from "emittery";
import { GraphQLSchema } from "graphql";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Factory } from "@/config/factories";
import type { LogFilter } from "@/config/logFilters";
import { UserError } from "@/errors/user";
import type { Common } from "@/Ponder";
import { buildSchema } from "@/schema/schema";
import type { Schema } from "@/schema/types";
import { buildGqlSchema } from "@/server/graphql/schema";

import {
  type IndexingFunctions,
  buildRawIndexingFunctions,
  hydrateIndexingFunctions,
} from "./functions";
import { readGraphqlSchema } from "./schema";

type BuildServiceEvents = {
  newConfig: undefined;
  newIndexingFunctions: { indexingFunctions: IndexingFunctions };
  newSchema: { schema: Schema; graphqlSchema: GraphQLSchema };
};

export class BuildService extends Emittery<BuildServiceEvents> {
  private common: Common;
  private logFilters: LogFilter[];
  private factories: Factory[];

  private closeWatcher?: () => Promise<void>;
  private latestFileHashes: Record<string, string | undefined> = {};

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

  async kill() {
    this.closeWatcher?.();
    this.common.logger.debug({
      service: "build",
      msg: `Killed build service`,
    });
  }

  watch() {
    const watchFiles = [
      this.common.options.configFile,
      this.common.options.schemaFile,
      this.common.options.srcDir,
    ];

    const watcher = chokidar.watch(watchFiles);
    this.closeWatcher = async () => {
      await watcher.close();
    };

    watcher.on("change", async (filePath) => {
      if (filePath === this.common.options.configFile) {
        this.emit("newConfig");
        return;
      }

      if (this.isFileChanged(filePath)) {
        const fileName = path.basename(filePath);

        this.common.logger.info({
          service: "build",
          msg: `Detected change in ${fileName}`,
        });

        this.common.errors.hasUserError = false;

        if (filePath === this.common.options.schemaFile) {
          this.buildSchema();
        } else {
          await this.buildIndexingFunctions();
        }
      }
    });
  }

  async buildIndexingFunctions() {
    try {
      const rawIndexingFunctions = await buildRawIndexingFunctions({
        options: this.common.options,
      });

      const indexingFunctions = hydrateIndexingFunctions({
        rawIndexingFunctions,
        logFilters: this.logFilters,
        factories: this.factories,
      });

      if (Object.values(indexingFunctions.eventSources).length === 0) {
        this.common.logger.warn({
          service: "build",
          msg: "No indexing functions found",
        });
      }

      this.emit("newIndexingFunctions", { indexingFunctions });
    } catch (error_) {
      const error = error_ as Error;

      // TODO: Build the UserError object within readIndexingFunctions, check instanceof,
      // then log/submit as-is if it's already a UserError.
      const message = `Error during build: ${error.message}`;
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

  private isFileChanged(filePath: string) {
    // TODO: I think this throws if the file being watched gets deleted while
    // the development server is running. Should handle this case gracefully.
    try {
      const content = readFileSync(filePath, "utf-8");
      const hash = createHash("md5").update(content).digest("hex");

      const prevHash = this.latestFileHashes[filePath];
      this.latestFileHashes[filePath] = hash;
      if (!prevHash) {
        // If there is no previous hash, this file is being changed for the first time.
        return true;
      } else {
        // If there is a previous hash, check if the content hash has changed.
        return prevHash !== hash;
      }
    } catch (e) {
      return true;
    }
  }
}
