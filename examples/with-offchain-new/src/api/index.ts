import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Hono } from "hono";
import * as combinedSchema from "../../schemas/combined.schema";
import * as offchainSchema from "../../schemas/offchain.schema";

const offchainWriterDb = drizzle(process.env.DATABASE_URL!, {
  schema: offchainSchema,
});
const combinedReaderDb = drizzle(process.env.DATABASE_URL!, {
  schema: combinedSchema,
});

await migrate(offchainWriterDb, { migrationsFolder: "./migrations" });

const app = new Hono();

app.post("/write-offchain-data", async (c) => {
  const { tokenId, metadata } = await c.req.json();
  await offchainWriterDb.insert(offchainSchema.metadataTable).values({
    tokenId,
    metadata,
  });
});

app.get("/read-combined-data", async (c) => {
  await combinedReaderDb.select().from(combinedSchema.account);
});

export default app;
