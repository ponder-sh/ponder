import type { EntityStore, PonderLogger } from "@ponder/core";
import cors from "cors";
import type { Express } from "express";
import express from "express";
import { graphqlHTTP } from "express-graphql";
import type { GraphQLSchema } from "graphql";
import http from "node:http";

export class GraphqlServer {
  port: number;
  context: { store: EntityStore };
  logger: PonderLogger;

  app: Express;
  server?: http.Server;
  graphqlMiddleware?: express.Handler;

  constructor(port: number, store: EntityStore, logger: PonderLogger) {
    this.port = port;
    this.context = { store };
    this.logger = logger;

    this.app = express();
    this.app.use(cors());
  }

  start(schema: GraphQLSchema, newPort?: number) {
    // This uses a small hack to update the GraphQL server on the fly.
    this.graphqlMiddleware = graphqlHTTP({
      schema: schema,
      context: this.context,
      graphiql: true,
    });

    if (!this.server) {
      const port = newPort || this.port;
      this.app.use("/graphql", (...args) => this.graphqlMiddleware!(...args));
      this.server = this.app.listen(port);
      // this.logger.info(
      //   `\x1b[35m${`Serving GraphQL API at http://localhost:${port}/graphql`}\x1b[0m`
      // ); // magenta
    } else if (newPort && newPort !== this.port) {
      this.port = newPort;
      // Close all connections to the now-stale server.
      this.server.close();
      this.server = this.app.listen(this.port);
      // this.logger.debug(`\x1b[35m${`Restarted GraphQL server`}\x1b[0m`); // magenta
    }
  }

  teardown() {
    this.server?.close();
  }
}
