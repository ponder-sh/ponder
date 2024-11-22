import { Hono } from "hono";
import { graphql } from "ponder";

export default new Hono().use("/", graphql()).use("/graphql", graphql());
