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
  console.log({ stack: app.stack });

  const returnedApp = app.use(
    "/graphql",
    graphqlHTTP({
      schema: gqlSchema,
      context: context,
      graphiql: true,
    })
  );

  console.log({ stack: returnedApp.stack });

  if (!isListening) {
    app.listen(PORT);
    console.log(
      `Running a GraphQL API server at http://localhost:${PORT}/graphql`
    );
    isListening = true;
  }

  console.log({ stack: returnedApp.stack });

  return app;
};

export { restartServer };
