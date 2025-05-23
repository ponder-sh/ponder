import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { metadata } from "./schema.js";

const db = drizzle(process.env.DATABASE_URL!, { casing: "snake_case" });

const databases = await db
  .select()
  .from(metadata)
  .where(
    and(
      eq(metadata.success, true),
      sql`${metadata.time} < NOW() - INTERVAL '1 day'`,
    ),
  );

for (const database of databases) {
  await db.execute(sql.raw(`DROP DATABASE "${database.id}"`));
}
