import express from "express";
import { graphqlHTTP } from "express-graphql";
import type { GraphQLSchema } from "graphql";

import { db } from "./db";

const context = {
  db,
};

const PORT = 4000;
const app = express();
let isListening = false;

const restartServer = (gqlSchema: GraphQLSchema) => {
  // If this function is not being called for the first time,
  // the graphqlHTTP middleware gets replaced using the new schema.
  app.use(
    "/graphql",
    graphqlHTTP({
      schema: gqlSchema,
      context: context,
      graphiql: true,
    })
  );

  if (!isListening) {
    app.listen(PORT);
    console.log(
      `Running a GraphQL API server at http://localhost:${PORT}/graphql`
    );
    isListening = true;
  }

  return app;
};

export { restartServer };
