import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startProxy } from "@viem/anvil";
import dotenv from "dotenv";
import { execa } from "execa";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function globalSetup() {
  dotenv.config({ path: ".env.local" });

  const generatedFilePath = join(__dirname, "generated.ts");
  if (!existsSync(generatedFilePath)) {
    await execa("pnpm", ["wagmi", "generate"]);
  }

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

if ("bun" in process.versions) {
  require("bun:test").beforeAll(async () => {
    await globalSetup();
  });
}

export default globalSetup;
