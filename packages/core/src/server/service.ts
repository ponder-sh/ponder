import cors from "cors";
import express from "express";
import { graphqlHTTP } from "express-graphql";
import type { GraphQLSchema } from "graphql";
import { createHttpTerminator } from "http-terminator";
import { createServer, Server } from "node:http";

import type { Common } from "@/Ponder.js";
import type { UserStore } from "@/user-store/store.js";
import { startClock } from "@/utils/timer.js";

export class ServerService {
  private common: Common;
  private userStore: UserStore;

  private port: number;
  app?: express.Express;

  private terminate?: () => Promise<void>;

  isHistoricalEventProcessingComplete = false;

  constructor({ common, userStore }: { common: Common; userStore: UserStore }) {
    this.common = common;
    this.userStore = userStore;
    this.port = this.common.options.port;
  }

  async start() {
    this.app = express();
    this.app.use(cors());

    this.app.use((req, res, next) => {
      const endClock = startClock();
      res.on("finish", () => {
        const responseDuration = endClock();
        const method = req.method;
        const path = new URL(req.url, `http://${req.get("host")}`).pathname;
        const status =
          res.statusCode >= 200 && res.statusCode < 300
            ? "2XX"
            : res.statusCode >= 300 && res.statusCode < 400
            ? "3XX"
            : res.statusCode >= 400 && res.statusCode < 500
            ? "4XX"
            : "5XX";

        const requestSize = Number(req.get("Content-Length") ?? 0);
        this.common.metrics.ponder_server_request_size.observe(
          { method, path, status },
          Number(requestSize)
        );

        const responseSize = Number(res.get("Content-Length") ?? 0);
        this.common.metrics.ponder_server_response_size.observe(
          { method, path, status },
          Number(responseSize)
        );

        this.common.metrics.ponder_server_response_duration.observe(
          { method, path, status },
          responseDuration
        );
      });
      next();
    });

    const server = await new Promise<Server>((resolve, reject) => {
      const server = createServer(this.app)
        .on("error", (error) => {
          if ((error as any).code === "EADDRINUSE") {
            this.common.logger.warn({
              service: "server",
              msg: `Port ${this.port} was in use, trying port ${this.port + 1}`,
            });
            this.port += 1;
            setTimeout(() => {
              server.close();
              server.listen(this.port);
            }, 5);
          } else {
            reject(error);
          }
        })
        .on("listening", () => {
          this.common.metrics.ponder_server_port.set(this.port);
          resolve(server);
        })
        .listen(this.port);
    });

    const terminator = createHttpTerminator({ server });
    this.terminate = () => terminator.terminate();

    this.common.logger.info({
      service: "server",
      msg: `Started listening on port ${this.port}`,
    });

    this.app.post("/metrics", async (_, res) => {
      try {
        res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
        res.end(await this.common.metrics.getMetrics());
      } catch (error) {
        res.status(500).end(error);
      }
    });

    this.app.get("/metrics", async (_, res) => {
      try {
        res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
        res.end(await this.common.metrics.getMetrics());
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

      const max = this.common.options.maxHealthcheckDuration;
      const elapsed = Math.floor(process.uptime());

      if (elapsed > max) {
        this.common.logger.warn({
          service: "server",
          msg: `Historical sync duration has exceeded the max healthcheck duration of ${max} seconds (current: ${elapsed}). Sevice is now responding as healthy and may serve incomplete data.`,
        });
        return res.status(200).send();
      }

      return res.status(503).send();
    });
  }

  reload({ graphqlSchema }: { graphqlSchema: GraphQLSchema }) {
    // This uses a small hack to update the GraphQL server on the fly.
    const graphqlMiddleware = graphqlHTTP({
      schema: graphqlSchema,
      context: { store: this.userStore },
      graphiql: true,
    });

    this.app?.use("/", graphqlMiddleware);
  }

  async kill() {
    await this.terminate?.();
    this.common.logger.debug({
      service: "server",
      msg: `Stopped listening on port ${this.port}`,
    });
  }

  setIsHistoricalEventProcessingComplete() {
    this.isHistoricalEventProcessingComplete = true;

    this.common.logger.info({
      service: "server",
      msg: `Started responding as healthy`,
    });
  }
}
