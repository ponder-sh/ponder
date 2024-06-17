import { hono } from "@/generated";
import { graphQLMiddleware } from "@/index.js";

hono.use("/graphql", graphQLMiddleware());
