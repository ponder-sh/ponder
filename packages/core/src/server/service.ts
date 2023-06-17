import cors from "cors";
import detectPort from "detect-port";
import Emittery from "emittery";
import express from "express";
import { graphqlHTTP } from "express-graphql";
import type { GraphQLSchema } from "graphql";
import { createHttpTerminator } from "http-terminator";

import { Resources } from "@/Ponder";
import { UserStore } from "@/user-store/store";

export type ServerServiceEvents = {
  serverStarted: { desiredPort: number; port: number };
};

export class ServerService extends Emittery<ServerServiceEvents> {
  resources: Resources;
  userStore: UserStore;

  app?: express.Express;
  private terminate?: () => Promise<void>;
  private graphqlMiddleware?: express.Handler;

  isHistoricalEventProcessingComplete = false;

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

    const server = this.app.listen(resolvedPort);
    const terminator = createHttpTerminator({ server });
    this.terminate = () => terminator.terminate();

    this.emit("serverStarted", {
      desiredPort: this.resources.options.port,
      port: resolvedPort,
    });

    this.app.post("/metrics", async (_, res) => {
      try {
        res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
        res.end(await this.resources.metrics.getMetrics());
      } catch (error) {
        res.status(500).end(error);
      }
    });

    this.app.get("/metrics", async (_, res) => {
      try {
        res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
        res.end(await this.resources.metrics.getMetrics());
      } catch (error) {
        res.status(500).end(error);
      }
    });

    // By default, the server will respond as unhealthy until historical events have
    // been processed OR 4.5 minutes have passed since the app was created. This
    // enables zero-downtime deployments on PaaS platforms like Railway and Render.
    // Also see https://github.com/0xOlias/ponder/issues/24
    this.app.get("/health", (_, res) => {
      if (this.isHistoricalEventProcessingComplete) {
        return res.status(200).send();
      }

      const max = this.resources.options.maxHealthcheckDuration;
      const elapsed = Math.floor(process.uptime());

      if (elapsed > max) {
        this.resources.logger.logMessage(
          "warning",
          `Historical sync duration has exceeded the max healthcheck duration of ${max} seconds (current: ${elapsed}). Sevice is now responding as healthy and may serve incomplete data.`
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

  async teardown() {
    await this.terminate?.();
  }
}
