import { Hono } from "hono";
import { client } from "ponder";

const app = new Hono();

app.use(client());

export default app;
