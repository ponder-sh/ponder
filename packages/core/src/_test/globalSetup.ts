import { startProxy } from "@viem/anvil";
import dotenv from "dotenv";
import { Pool } from "pg";

export default async function () {
  dotenv.config({ path: ".env.local" });

  const shutdownProxy = await startProxy({
    options: {
      chainId: 1,
      noMining: true,
    },
  });

  let cleanupDatabase: () => Promise<void>;
  if (process.env.DATABASE_URL) {
    cleanupDatabase = async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });

      const databaseRows = await pool.query(`
        SELECT datname FROM pg_database WHERE datname LIKE 'vitest_%';
      `);
      const databases = databaseRows.rows.map((r) => r.datname) as string[];

      await Promise.all(
        databases.map((databaseName) =>
          pool.query(`DROP DATABASE "${databaseName}"`),
        ),
      );

      await pool.end();
    };
  }

  return async () => {
    await shutdownProxy();
    await cleanupDatabase?.();
  };
}
