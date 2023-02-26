import cors from "cors";
import express from "express";
import { graphqlHTTP } from "express-graphql";
import type http from "node:http";

import { MessageKind } from "@/common/logger";
import type { Ponder } from "@/Ponder";

export class Server {
  ponder: Ponder;

  app: express.Express;
  server: http.Server;
  graphqlMiddleware?: express.Handler;

  constructor({ ponder }: { ponder: Ponder }) {
    this.ponder = ponder;

    this.app = express();
    this.app.use(cors());
    this.server = this.app.listen(ponder.options.PORT);

    this.app.get("/", (req, res) => res.redirect(302, "/graphql"));

    // By default, the server will respond as unhealthy until the backfill logs have
    // been processed OR 4.5 minutes have passed since the app was created. This
    // enables zero-downtime deployments on PaaS platforms like Railway and Render.
    // Also see https://github.com/0xOlias/ponder/issues/24
    this.app.get("/health", (_, res) => {
      if (this.ponder.isLogProcessingComplete) {
        return res.status(200).send();
      }

      const max = this.ponder.options.MAX_HEALTHCHECK_DURATION;
      const elapsed =
        Math.floor(Date.now() / 1000) - this.ponder.setupTimestamp;

      if (elapsed > max) {
        this.ponder.logMessage(
          MessageKind.WARNING,
          `Backfill & log processing time has exceeded the max healthcheck duration of ${max} seconds (current: ${elapsed}). Sevice is now responding as healthy and may serve incomplete data.`
        );
        return res.status(200).send();
      }

      return res.status(503).send();
    });
  }

  reload() {
    if (!this.ponder.graphqlSchema) return;

    // This uses a small hack to update the GraphQL server on the fly.
    this.graphqlMiddleware = graphqlHTTP({
      schema: this.ponder.graphqlSchema,
      context: {
        store: this.ponder.entityStore,
      },
      graphiql: true,
    });

    this.app.use("/graphql", (...args) => this.graphqlMiddleware?.(...args));
  }

  teardown() {
    return new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}
