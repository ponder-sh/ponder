import { db } from "ponder:api";
import { Hono } from "hono";
import { client } from "ponder";

const app = new Hono();

app.use(client({ db }));

export default app;
