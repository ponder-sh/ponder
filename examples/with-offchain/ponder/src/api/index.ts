import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import * as offchainSchema from "../../../offchain/src/offchain";

const offchainDb = drizzle(process.env.DATABASE_URL!, {
  schema: offchainSchema,
});

const app = new Hono();

app.post("/new-metadata", async (c) => {
  const { tokenId, metadata } = await c.req.json();
  await offchainDb.insert(offchainSchema.metadataTable).values({
    tokenId,
    metadata,
  });
});

export default app;
