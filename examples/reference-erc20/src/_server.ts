import { graphQLMiddleware, hono } from "@/generated";
import { createGraphQLMiddleware } from "@ponder/core";

hono.use("/graphql", graphQLMiddleware());

hono.get("/router", (c) => {
  return c.text("kevin");
});

export { hono };
