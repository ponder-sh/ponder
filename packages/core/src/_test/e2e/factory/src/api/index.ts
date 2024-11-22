import { graphql } from "@/index.js";
import { Hono } from "hono";

export default new Hono().use("/graphql", graphql());
