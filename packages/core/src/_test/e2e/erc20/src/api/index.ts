import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client } from "@/index.js";

const app = new Hono();

app.use("/sql/*", client({ db, schema }));

export default app;
