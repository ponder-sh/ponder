import chokidar from "chokidar";
import Emittery from "emittery";
import { GraphQLSchema } from "graphql";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import pico from "picocolors";

import { Resources } from "@/Ponder";
import { buildSchema } from "@/schema/schema";
import { Schema } from "@/schema/types";
import { buildGqlSchema } from "@/server/graphql/buildGqlSchema";

import { readGraphqlSchema } from "./readGraphqlSchema";
import { Handlers, readHandlers } from "./readHandlers";

type ReloadServiceEvents = {
  ponderConfigChanged: undefined;
  projectFileChanged: undefined;
  newHandlers: { handlers: Handlers };
  newSchema: { schema: Schema; graphqlSchema: GraphQLSchema };
};

export class ReloadService extends Emittery<ReloadServiceEvents> {
  resources: Resources;

  latestFileHashes: Record<string, string | undefined> = {};
  closeWatcher?: () => Promise<void>;

  constructor({ resources }: { resources: Resources }) {
    super();
    this.resources = resources;
  }

  watch() {
    const watchFiles = [
      this.resources.options.configFile,
      this.resources.options.schemaFile,
      this.resources.options.srcDir,
    ];

    const watcher = chokidar.watch(watchFiles);
    this.closeWatcher = async () => {
      await watcher.close();
    };

    watcher.on("change", async (filePath) => {
      if (filePath === this.resources.options.configFile) {
        this.emit("ponderConfigChanged");
        return;
      }

      if (this.isFileChanged(filePath)) {
        const fileName = path.basename(filePath);

        this.resources.logger.info({ msg: `Detected change in ${fileName}` });

        this.resources.errors.clearHandlerError();

        if (filePath === this.resources.options.schemaFile) {
          this.loadSchema();
        } else {
          await this.loadHandlers();
        }
      }
    });
  }

  async kill() {
    this.closeWatcher?.();
    this.resources.logger.debug({ msg: `Killed build service` });
  }

  async loadHandlers() {
    try {
      const handlers = await readHandlers({
        options: this.resources.options,
        logger: this.resources.logger,
      });
      this.emit("newHandlers", { handlers });
    } catch (error_) {
      const error = error_ as Error;
      error.message = "Building event handlers: " + error.message;
      this.resources.errors.submitHandlerError({ error });
    }
  }

  loadSchema() {
    try {
      const userGraphqlSchema = readGraphqlSchema({
        options: this.resources.options,
      });
      const schema = buildSchema(userGraphqlSchema);
      const graphqlSchema = buildGqlSchema(schema);
      this.emit("newSchema", { schema, graphqlSchema });
      return { schema, graphqlSchema };
    } catch (error_) {
      const error = error_ as Error;
      error.message = "Building schema: " + error.message;
      error.stack = "";
      this.resources.errors.submitHandlerError({ error });
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
