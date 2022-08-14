import express from "express";
import { graphqlHTTP } from "express-graphql";
import type { GraphQLSchema } from "graphql";

import { db } from "./db";

const context = { db };
const PORT = 4000;
const app = express();
let isInitialized = false;
let graphqlMiddleware: express.Handler;

const restartServer = (gqlSchema: GraphQLSchema) => {
  // This uses a small hack to update the GraphQL server at runtime.
  graphqlMiddleware = graphqlHTTP({
    schema: gqlSchema,
    context: context,
    graphiql: true,
  });

  if (!isInitialized) {
    isInitialized = true;
    app.use("/graphql", (...args) => graphqlMiddleware(...args));
    app.listen(PORT);
    console.log(
      `Started the GraphQL server at http://localhost:${PORT}/graphql`
    );
  } else {
    console.log(`Restarted the GraphQL server`);
  }

  return app;
};

export { restartServer };
