import express from "express";
import { graphqlHTTP } from "express-graphql";
import type { GraphQLSchema } from "graphql";
import http from "node:http";

import { db } from "@/db";
import type { PonderConfig } from "@/types";
import { logger } from "@/utils";

const context = { db };
const app = express();
let server: http.Server;
let prevPort = 0;
let graphqlMiddleware: express.Handler;

const startServer = (config: PonderConfig, gqlSchema: GraphQLSchema) => {
  // This uses a small hack to update the GraphQL server at runtime.
  graphqlMiddleware = graphqlHTTP({
    schema: gqlSchema,
    context: context,
    graphiql: true,
  });

  const newPort = config.apis[0].port;

  if (!server) {
    app.use("/graphql", (...args) => graphqlMiddleware(...args));
    server = app.listen(newPort);
    logger.info(
      `\x1b[35m${`SERVING GRAPHQL API AT http://localhost:${newPort}/graphql`}\x1b[0m`
    ); // magenta
  } else if (newPort !== prevPort) {
    // Close all connections to the now-stale server.
    server.close();
    server = app.listen(newPort);
    logger.info(
      `\x1b[35m${`SERVING GRAPHQL API AT http://localhost:${newPort}/graphql`}\x1b[0m`
    ); // magenta
  } else {
    logger.info(`\x1b[35m${`RESTARTED GRAPHQL API`}\x1b[0m`); // magenta
  }

  prevPort = newPort;

  return app;
};

export { startServer };
