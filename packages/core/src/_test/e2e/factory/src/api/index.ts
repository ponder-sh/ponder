import { db } from "ponder:api";
import { client } from "@/index.js";
import { Hono } from "hono";

const app = new Hono();

app.use("/graphql", client({ db }));

export default app;
