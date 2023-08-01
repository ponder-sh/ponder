import chokidar from "chokidar";
import Emittery from "emittery";
import { GraphQLSchema } from "graphql";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { LogFilter } from "@/config/logFilters.js";
import { UserError } from "@/errors/user.js";
import type { Common } from "@/Ponder.js";
import { buildSchema } from "@/schema/schema.js";
import type { Schema } from "@/schema/types.js";
import { buildGqlSchema } from "@/server/graphql/schema.js";

import {
  type HandlerFunctions,
  buildRawHandlerFunctions,
  hydrateHandlerFunctions,
} from "./handlers.js";
import { readGraphqlSchema } from "./schema.js";

type BuildServiceEvents = {
  newConfig: undefined;
  newHandlers: { handlers: HandlerFunctions };
  newSchema: { schema: Schema; graphqlSchema: GraphQLSchema };
};

export class BuildService extends Emittery<BuildServiceEvents> {
  private common: Common;
  private logFilters: LogFilter[];

  private closeWatcher?: () => Promise<void>;
  private latestFileHashes: Record<string, string | undefined> = {};

  constructor({
    common,
    logFilters,
  }: {
    common: Common;
    logFilters: LogFilter[];
  }) {
    super();
    this.common = common;
    this.logFilters = logFilters;
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
          await this.buildHandlers();
        }
      }
    });
  }

  async buildHandlers() {
    try {
      const rawHandlerFunctions = await buildRawHandlerFunctions({
        options: this.common.options,
      });

      const handlers = hydrateHandlerFunctions({
        rawHandlerFunctions,
        logFilters: this.logFilters,
      });

      if (Object.values(handlers.logFilters).length === 0) {
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
