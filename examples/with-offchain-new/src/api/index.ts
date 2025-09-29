import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Hono } from "hono";
import { replaceBigInts } from "ponder";
import * as combinedSchema from "../../schemas/combined.schema";
import * as offchainSchema from "../../schemas/offchain.schema";

const offchainWriterDb = drizzle(process.env.DATABASE_URL!, {
  schema: offchainSchema,
});
const combinedReaderDb = drizzle(process.env.DATABASE_URL!, {
  schema: combinedSchema,
});

await offchainWriterDb.execute(`CREATE SCHEMA IF NOT EXISTS "offchain"`);
await migrate(offchainWriterDb, { migrationsFolder: "./migrations" });

const app = new Hono();

app.post("/grafitti", async (c) => {
  const { address, message } = await c.req.json();

  await offchainWriterDb
    .insert(offchainSchema.accountMetadata)
    .values({
      address: address,
      graffiti: message,
    })
    .onConflictDoUpdate({
      target: offchainSchema.accountMetadata.address,
      set: { graffiti: message },
    });

  return c.text("success");
});

app.get("/account", async (c) => {
  const rows = await combinedReaderDb
    .select({
      address: combinedSchema.account.address,
      balance: combinedSchema.account.balance,
      grafitti: combinedSchema.accountMetadata.graffiti,
    })
    .from(combinedSchema.account)
    .leftJoin(
      combinedSchema.accountMetadata,
      eq(
        combinedSchema.account.address,
        combinedSchema.accountMetadata.address,
      ),
    );

  return c.json(replaceBigInts(rows, (b) => b.toString()));
});

export default app;
