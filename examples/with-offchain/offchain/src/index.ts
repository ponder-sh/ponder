import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { schema } from "./schema";

console.log(`Using database URL: ${process.env.DATABASE_URL}`);

export const db = drizzle(process.env.DATABASE_URL!, { schema });

await migrate(db, { migrationsFolder: "./migrations" });

await db
  .insert(schema.metadataTable)
  .values({ tokenId: "8882", metadata: { name: "test" } })
  .onConflictDoNothing();

const result = await db.query.metadataTable.findMany({
  with: {
    token: true,
  },
});

console.log("Query result:", result);
