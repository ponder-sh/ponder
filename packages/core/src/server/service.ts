import cors from "cors";
import express from "express";
import type { FormattedExecutionResult, GraphQLSchema } from "graphql";
import { formatError, GraphQLError } from "graphql";
import { createHandler } from "graphql-http/lib/use/express";
import { createHttpTerminator } from "http-terminator";
import type { Server } from "node:http";
import { createServer } from "node:http";

import type { IndexingStore } from "@/indexing-store/store.js";
import type { Common } from "@/Ponder.js";
import { graphiQLHtml } from "@/ui/graphiql.html.js";
import { startClock } from "@/utils/timer.js";

export class ServerService {
  private common: Common;
  private indexingStore: IndexingStore;

  private port: number;
  app?: express.Express;

  private terminate?: () => Promise<void>;

  isHistoricalIndexingComplete = false;

  constructor({
    common,
    indexingStore,
  }: {
    common: Common;
    indexingStore: IndexingStore;
  }) {
    this.common = common;
    this.indexingStore = indexingStore;
    this.port = this.common.options.port;
  }

  async start() {
    this.app = express();
    this.app.use(cors({ methods: ["GET", "POST", "OPTIONS", "HEAD"] }));
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

    // By default, the server will respond as unhealthy until historical index has
    // been processed OR 4.5 minutes have passed since the app was created. This
    // enables zero-downtime deployments on PaaS platforms like Railway and Render.
    // Also see https://github.com/0xOlias/ponder/issues/24
    this.app.get("/health", (_, res) => {
      if (this.isHistoricalIndexingComplete) {
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
    const graphqlMiddleware = createHandler({
      schema: graphqlSchema,
      context: { store: this.indexingStore },
    });

    /**
     * GET /graphql -> returns graphiql page html
     * POST /graphql -> returns query result
     */
    this.app?.use("/graphql", (request, response, next) => {
      // While waiting for historical indexing to complete, we want to respond back
      // with an error to prevent the requester from accepting incomplete data.
      if (!this.isHistoricalIndexingComplete) {
        // Respond back with a similar runtime query error as the GraphQL package.
        // https://github.com/graphql/express-graphql/blob/3fab4b1e016cd27655f3b013f65a6b1344520d01/src/index.ts#L397-L400
        const errors = [
          formatError(new GraphQLError("Historical indexing is not complete")),
        ];
        const result: FormattedExecutionResult = {
          data: undefined,
          errors,
        };
        return response.status(503).json(result);
      }

      switch (request.method) {
        case "POST":
          return graphqlMiddleware(request, response, next);
        case "GET": {
          const host = request.get("host");
          if (!host) {
            return response.status(400).send("No host header provided");
          }
          const protocol = ["localhost", "0.0.0.0", "127.0.0.1"].includes(host)
            ? "http"
            : "https";
          const endpoint = `${protocol}://${host}`;
          return response
            .status(200)
            .setHeader("Content-Type", "text/html")
            .send(graphiQLHtml({ endpoint }));
        }
        case "HEAD":
          return response.status(200).send();
        default:
          return next();
      }
    });

    /**
     * GET / -> returns graphiql page html
     * POST / -> expects returns query result
     */
    this.app?.use("/", (request, response, next) => {
      switch (request.method) {
        case "POST":
          return graphqlMiddleware(request, response, next);
        case "GET": {
          const host = request.get("host");
          if (!host) {
            return response.status(400).send("No host header provided");
          }
          const protocol = [
            "localhost:42069",
            "0.0.0.0:42069",
            "127.0.0.1:42069",
          ].includes(host)
            ? "http"
            : "https";
          const endpoint = `${protocol}://${host}`;
          return response
            .status(200)
            .setHeader("Content-Type", "text/html")
            .send(graphiQLHtml({ endpoint }));
        }
        case "HEAD":
          return response.status(200).send();
        default:
          return next();
      }
    });
  }

  async kill() {
    await this.terminate?.();
    this.common.logger.debug({
      service: "server",
      msg: `Stopped listening on port ${this.port}`,
    });
  }

  setIsHistoricalIndexingComplete() {
    this.isHistoricalIndexingComplete = true;

    this.common.logger.info({
      service: "server",
      msg: `Started responding as healthy`,
    });
  }
}
