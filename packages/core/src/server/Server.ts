import cors from "cors";
import express from "express";
import { graphqlHTTP } from "express-graphql";
import type http from "node:http";

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

    this.app.get("/", (req, res) => res.redirect(302, "/graphql"));
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
