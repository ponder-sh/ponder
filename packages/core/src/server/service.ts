import type { Server } from "node:http";
import { createServer } from "node:http";

import { Emittery } from "@/utils/emittery.js";
import cors from "cors";
import express, { type Handler } from "express";
import type { FormattedExecutionResult, GraphQLSchema } from "graphql";
import { GraphQLError, formatError } from "graphql";
import { createHandler } from "graphql-http/lib/use/express";
import { createHttpTerminator } from "http-terminator";

import type { Common } from "@/Ponder.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import { graphiQLHtml } from "@/ui/graphiql.html.js";

type ServerEvents = {
  "admin:reload": { chainId: number };
};

export class ServerService extends Emittery<ServerEvents> {
  app: express.Express;

  private common: Common;
  private indexingStore: IndexingStore;

  private port: number;
  private terminate?: () => Promise<void>;
  private graphqlMiddleware?: Handler;

  isHistoricalIndexingComplete = false;

  constructor({
    common,
    indexingStore,
  }: {
    common: Common;
    indexingStore: IndexingStore;
  }) {
    super();

    this.common = common;
    this.indexingStore = indexingStore;
    this.app = express();

    // This gets updated to the resolved port if the requested port is in use.
    this.port = this.common.options.port;
  }

  setup({ registerDevRoutes }: { registerDevRoutes: boolean }) {
    // Middleware.
    this.app.use(cors({ methods: ["GET", "POST", "OPTIONS", "HEAD"] }));

    // Observability routes.
    this.app.all("/metrics", this.handleMetrics());
    this.app.get("/health", this.handleHealthGet());

    // GraphQL routes.
    this.app?.all(
      "/graphql",
      this.handleGraphql({ shouldWaitForHistoricalSync: true }),
    );
    this.app?.all(
      "/",
      this.handleGraphql({ shouldWaitForHistoricalSync: false }),
    );

    if (registerDevRoutes) {
      this.app.post("/admin/reload", this.handleAdminReload());
    }
  }

  async start() {
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
              server.listen(this.port, this.common.options.hostname);
            }, 5);
          } else {
            reject(error);
          }
        })
        .on("listening", () => {
          this.common.metrics.ponder_server_port.set(this.port);
          resolve(server);
        })
        // Note that this.common.options.hostname can be undefined if the user did not specify one.
        // In this case, Node.js uses `::` if IPv6 is available and `0.0.0.0` otherwise.
        // https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback
        .listen(this.port, this.common.options.hostname);
    });

    const terminator = createHttpTerminator({ server });
    this.terminate = () => terminator.terminate();

    this.common.logger.info({
      service: "server",
      msg: `Started listening on port ${this.port}`,
    });
  }

  async kill() {
    await this.terminate?.();
    this.common.logger.debug({
      service: "server",
      msg: `Killed server, stopped listening on port ${this.port}`,
    });
  }

  reloadGraphqlSchema({ graphqlSchema }: { graphqlSchema: GraphQLSchema }) {
    this.graphqlMiddleware = createHandler({
      schema: graphqlSchema,
      context: { store: this.indexingStore },
    });
  }

  setIsHistoricalIndexingComplete() {
    this.isHistoricalIndexingComplete = true;

    this.common.logger.info({
      service: "server",
      msg: "Started responding as healthy",
    });
  }

  // Route handlers.
  private handleMetrics(): Handler {
    return async (req, res) => {
      if (req.method !== "GET" && req.method !== "POST") {
        res.status(404).end();
      }

      try {
        res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
        res.end(await this.common.metrics.getMetrics());
      } catch (error) {
        res.status(500).end(error);
      }
    };
  }

  private handleHealthGet(): Handler {
    return (_, res) => {
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
    };
  }

  private handleGraphql({
    shouldWaitForHistoricalSync,
  }: {
    shouldWaitForHistoricalSync: boolean;
  }): Handler {
    return (req, res, next) => {
      if (!this.graphqlMiddleware) {
        return next();
      }

      // While waiting for historical indexing to complete, we want to respond back
      // with an error to prevent the requester from accepting incomplete data.
      if (shouldWaitForHistoricalSync && !this.isHistoricalIndexingComplete) {
        // Respond back with a similar runtime query error as the GraphQL package.
        // https://github.com/graphql/express-graphql/blob/3fab4b1e016cd27655f3b013f65a6b1344520d01/src/index.ts#L397-L400
        const errors = [
          formatError(new GraphQLError("Historical indexing is not complete")),
        ];
        const result: FormattedExecutionResult = {
          data: undefined,
          errors,
        };
        return res.status(503).json(result);
      }

      switch (req.method) {
        case "POST":
          return this.graphqlMiddleware(req, res, next);
        case "GET": {
          return res
            .status(200)
            .setHeader("Content-Type", "text/html")
            .send(graphiQLHtml);
        }
        case "HEAD":
          return res.status(200).send();
        default:
          return next();
      }
    };
  }

  private handleAdminReload(): Handler {
    return async (req, res) => {
      try {
        const chainId = parseInt(req.query.chainId as string, 10);
        if (Number.isNaN(chainId)) {
          res.status(400).end("chainId must exist and be a valid integer");
          return;
        }
        this.emit("admin:reload", { chainId });
        res.status(200).end();
      } catch (error) {
        res.status(500).end(error);
      }
    };
  }
}
