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

// Note: A run drops the copy of the template for its expected tables. Drop copies that a
// run did not drop, for example after a timeout.
const oracles = await db.execute<{ datname: string }>(
  sql`SELECT datname FROM pg_database WHERE right(datname, 7) = '_oracle'`,
);
let oracleCount = 0;
for (const { datname } of oracles.rows) {
  const id = datname.slice(0, -"_oracle".length);
  const [run] = await db
    .select()
    .from(metadata)
    .where(sql`${metadata.id}::text = ${id}`);
  if (run === undefined || run.time < new Date(Date.now() - 60 * 60 * 1_000)) {
    await db.execute(
      sql.raw(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`),
    );
    oracleCount += 1;
  }
}
console.log(`Deleted ${oracleCount} expected table databases`);
