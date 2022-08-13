import express from "express";
import { graphqlHTTP } from "express-graphql";
import type { GraphQLSchema } from "graphql";

import { db } from "./db";

const context = {
  db,
};

const startServer = (gqlSchema: GraphQLSchema) => {
  const app = express();

  app.use(
    "/graphql",
    graphqlHTTP({
      schema: gqlSchema,
      context: context,
      graphiql: true,
    })
  );

  app.listen(4000);
  console.log("Running a GraphQL API server at http://localhost:4000/graphql");

  return app;
};

export { startServer };
