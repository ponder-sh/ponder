import { db } from "ponder:api";
import schema from "ponder:schema";
import { graphql } from "@/index.js";
import { Hono } from "hono";

const app = new Hono();

app.use("/graphql", graphql({ db, schema }));

export default app;
