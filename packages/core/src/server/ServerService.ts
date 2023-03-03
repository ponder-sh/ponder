import cors from "cors";
import express from "express";
import { graphqlHTTP } from "express-graphql";
import type { GraphQLSchema } from "graphql";
import type http from "node:http";

import { MessageKind } from "@/common/logger";
import { Resources } from "@/Ponder2";

export class ServerService {
  resources: Resources;

  app: express.Express;
  server: http.Server;
  graphqlMiddleware?: express.Handler;

  constructor({ resources }: { resources: Resources }) {
    this.resources = resources;

    this.app = express();
    this.app.use(cors());
    this.server = this.app.listen(this.resources.options.PORT);

    this.app.get("/", (req, res) => res.redirect(302, "/graphql"));

    // By default, the server will respond as unhealthy until the backfill logs have
    // been processed OR 4.5 minutes have passed since the app was created. This
    // enables zero-downtime deployments on PaaS platforms like Railway and Render.
    // Also see https://github.com/0xOlias/ponder/issues/24
    this.app.get("/health", (_, res) => {
      // TODO: figure out where to get this from.
      // if (this.ponder.isLogProcessingComplete) {
      return res.status(200).send();
      // }

      const max = this.resources.options.MAX_HEALTHCHECK_DURATION;
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
        store: this.resources.entityStore,
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
