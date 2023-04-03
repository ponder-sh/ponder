import { POSTGRES_TABLE_PREFIX } from "@/database/cache/postgresCacheStore";
import { SQLITE_TABLE_PREFIX } from "@/database/cache/sqliteCacheStore";
import { PonderDatabase } from "@/database/db";

export async function resetCacheStore(database: PonderDatabase) {
  let prefix: string;

  if (database.kind === "sqlite") {
    prefix = SQLITE_TABLE_PREFIX;

    database.db.prepare(`DELETE FROM "${prefix}logFilterCachedRanges"`).run();
    database.db.prepare(`DELETE FROM "${prefix}logs"`).run();
    database.db.prepare(`DELETE FROM "${prefix}blocks"`).run();
    database.db.prepare(`DELETE FROM "${prefix}transactions"`).run();
    database.db.prepare(`DELETE FROM "${prefix}contractCalls"`).run();
  } else {
    prefix = POSTGRES_TABLE_PREFIX;

    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM "${prefix}logFilterCachedRanges"`);
      await client.query(`DELETE FROM "${prefix}logs"`);
      await client.query(`DELETE FROM "${prefix}blocks"`);
      await client.query(`DELETE FROM "${prefix}transactions"`);
      await client.query(`DELETE FROM "${prefix}contractCalls"`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
