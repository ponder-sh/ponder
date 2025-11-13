import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { metadata } from "../schema.js";

const db = drizzle(process.env.DATABASE_URL!, { casing: "snake_case" });

const databases = await db
  .select()
  .from(metadata)
  .where(eq(metadata.success, true));

for (const database of databases) {
  await db.execute(sql.raw(`DROP DATABASE IF EXISTS "${database.id}"`));
  await db.delete(metadata).where(eq(metadata.id, database.id));
}
console.log(`Deleted ${databases.length} databases`);
