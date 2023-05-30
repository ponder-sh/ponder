import cors from "cors";
import detectPort from "detect-port";
import Emittery from "emittery";
import express from "express";
import { graphqlHTTP } from "express-graphql";
import type { GraphQLSchema } from "graphql";
import type http from "node:http";

import { Resources } from "@/Ponder";
import { UserStore } from "@/user-store/store";
import { MessageKind } from "@/utils/logger";

export type ServerServiceEvents = {
  serverStarted: { desiredPort: number; port: number };
};

export class ServerService extends Emittery<ServerServiceEvents> {
  resources: Resources;
  userStore: UserStore;

  app?: express.Express;
  server?: http.Server;
  private graphqlMiddleware?: express.Handler;

  isBackfillEventProcessingComplete = false;

  constructor({
    resources,
    userStore,
  }: {
    resources: Resources;
    userStore: UserStore;
  }) {
    super();
    this.resources = resources;
    this.userStore = userStore;
  }

  async start() {
    this.app = express();
    this.app.use(cors());

    // If the desired port is unavailable, detect-port will find the next available port.
    const resolvedPort = await detectPort(this.resources.options.port);

    this.server = this.app.listen(resolvedPort);

    this.emit("serverStarted", {
      desiredPort: this.resources.options.port,
      port: resolvedPort,
    });

    // By default, the server will respond as unhealthy until the backfill events have
    // been processed OR 4.5 minutes have passed since the app was created. This
    // enables zero-downtime deployments on PaaS platforms like Railway and Render.
    // Also see https://github.com/0xOlias/ponder/issues/24
    this.app.get("/health", (_, res) => {
      if (this.isBackfillEventProcessingComplete) {
        return res.status(200).send();
      }

      const max = this.resources.options.maxHealthcheckDuration;
      const elapsed = Math.floor(process.uptime());

      if (elapsed > max) {
        this.resources.logger.logMessage(
          MessageKind.WARNING,
          `Backfill & log processing time has exceeded the max healthcheck duration of ${max} seconds (current: ${elapsed}). Sevice is now responding as healthy and may serve incomplete data.`
        );
        return res.status(200).send();
      }

      return res.status(503).send();
    });
  }

  reload({ graphqlSchema }: { graphqlSchema: GraphQLSchema }) {
    // This uses a small hack to update the GraphQL server on the fly.
    this.graphqlMiddleware = graphqlHTTP({
      schema: graphqlSchema,
      context: {
        store: this.userStore,
      },
      graphiql: true,
    });

    this.app?.use("/", (...args) => this.graphqlMiddleware?.(...args));
  }

  teardown() {
    this.server?.unref();
    return new Promise<void>((resolve, reject) => {
      this.server?.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}
