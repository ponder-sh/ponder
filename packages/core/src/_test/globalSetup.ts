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

      const schemaRows = await pool.query(`
        SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname ~ '^vitest_pool_';
      `);
      const schemas = schemaRows.rows.map((r) => r.nspname) as string[];

      for (const schema of schemas) {
        const tableRows = await pool.query(`
          SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}'
        `);
        const tables = tableRows.rows.map((r) => r.table_name) as string[];

        for (const table of tables) {
          await pool.query(
            `DROP TABLE IF EXISTS "${schema}"."${table}" CASCADE`,
          );
        }
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        console.log(`Dropped ${tables.length} tables from schema "${schema}".`);
      }

      await pool.end();
    };
  }

  return async () => {
    await shutdownProxy();
    await cleanupDatabase?.();
  };
}
