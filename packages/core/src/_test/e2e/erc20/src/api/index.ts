import { db } from "ponder:api";
import schema from "ponder:schema";
import { client } from "@/index.js";
import { Hono } from "hono";

const app = new Hono();

app.use("/sql/*", client({ db, schema }));

export default app;
