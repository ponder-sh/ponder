import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startProxy } from "@viem/anvil";
import dotenv from "dotenv";
import { execa } from "execa";
import { Pool } from "pg";
import { IS_BUN_TEST } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function globalSetup() {
  dotenv.config({ path: ".env.local" });

  const generatedFilePath = join(__dirname, "generated.ts");
  if (!existsSync(generatedFilePath)) {
    await execa("pnpm", ["wagmi", "generate"]);
  }

  await startProxy({
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
        SELECT datname FROM pg_database WHERE datname LIKE 'test_%';
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
    await cleanupDatabase?.();
  };
}

function resetPonderGlobals() {
  // Note: PONDER_COMMON is not reset because it is used for cleanup in between tests.
  // @ts-ignore
  globalThis.PONDER_PRE_BUILD = undefined;
  // @ts-ignore
  globalThis.PONDER_DATABASE = undefined;
  // @ts-ignore
  globalThis.PONDER_NAMESPACE_BUILD = undefined;
  // @ts-ignore
  globalThis.PONDER_INDEXING_BUILD = undefined;
}

if (IS_BUN_TEST) {
  // Note: Must be run outside of hook because missing the generated
  // files causes test to fail with 'Cannot find module' error.
  await globalSetup();
  const { beforeEach, afterEach } = require("bun:test");
  beforeEach(resetPonderGlobals);
  afterEach(resetPonderGlobals);
}

export default globalSetup;
