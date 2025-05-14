import { $ } from "bun";
import { Table, eq, getTableName, is, sql } from "drizzle-orm";
import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import { customType, pgSchema } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import seedrandom from "seedrandom";
import {
  type SimParams,
  debug,
} from "../packages/core/src/bin/commands/debug.js";
import { getChunks } from "../packages/core/src/utils/interval.js";

// inputs
const APP_DIR = "./apps/reference-erc20";
const APP_ID = "reference-erc20";
const SEED = "dff1a6a325d3ac4a42143e0d60aa1dc25dc69b19694dab3739eabc5c2aa5001e";
const CONNECTION_STRING = "postgresql://kylescott@localhost:5432/integration";

// params

const INTERVAL_CHUNKS = 8;
const INTERVAL_EVICT_RATE = 0.0;

const SIM_PARAMS: SimParams = {
  SEED,
  ERROR_RATE: 0.01,
  ETH_GET_LOGS_RESPONSE_LIMIT: Number.POSITIVE_INFINITY,
  ETH_GET_LOGS_BLOCK_LIMIT: 20_000,
  /** Probability of a reorg. */
  REALTIME_REORG_RATE: 0.05,
  /** Probability of a deep reorg. */
  REALTIME_DEEP_REORG_RATE: 0,
  // TODO(kyle) deep reorg
  /** Probability that the chain fast forwards and skips a block. */
  REALTIME_FAST_FORWARD_RATE: 0.5,
  /** Probability that a block is delayed and a block on another chain is ordered first. */
  REALTIME_DELAY_RATE: 0.4,
  FINALIZED_RATE: 0.97,
};

// constants
const TARGET_SCHEMA = "test";
const TARGET_SYNC_SCHEMA = "ponder_sync";

const INTERVALS = pgSchema("ponder_sync").table("intervals", (t) => ({
  fragmentId: t.text().notNull().primaryKey(),
  chainId: t.bigint({ mode: "bigint" }).notNull(),
  blocks: customType<{ data: string }>({
    dataType() {
      return "nummultirange";
    },
  })().notNull(),
}));

const compareTables = async (
  db: NodePgDatabase,
  expected: string,
  actual: string,
) => {
  // missing or different rows
  let rows = await db.execute(
    sql.raw(`SELECT * FROM ${expected} EXCEPT SELECT * FROM ${actual}`),
  );

  if (rows.rows.length > 0) {
    console.error(
      `Failed database validation for ${actual}, missing or different rows`,
    );
    console.log(rows.rows);
    process.exit(1);
  }

  // extra rows
  rows = await db.execute(
    sql.raw(`SELECT * FROM ${actual} EXCEPT SELECT * FROM ${expected}`),
  );

  if (rows.rows.length > 0) {
    console.error(`Failed database validation for ${actual}, extra rows`);
    console.log(rows.rows);
    process.exit(1);
  }
};

const pool = new Pool({ connectionString: CONNECTION_STRING });
const db = drizzle(pool, { casing: "snake_case" });

await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${TARGET_SCHEMA}" CASCADE`));
await db.execute(
  sql.raw(`DROP SCHEMA IF EXISTS "${TARGET_SYNC_SCHEMA}" CASCADE`),
);
await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${APP_ID}_expected" CASCADE`));

await $`psql ${CONNECTION_STRING} -U postgres -h localhost -p 5432 -f ./db/${APP_ID}_expected.sql`.quiet();
await $`psql ${CONNECTION_STRING} -U postgres -h localhost -p 5432 -f ./db/${APP_ID}_ponder_sync.sql`.quiet();

await db.execute(
  sql.raw(
    `CREATE INDEX transactions_integration_idx ON "ponder_sync".transactions (chain_id, block_number)`,
  ),
);

await db.execute(
  sql.raw(
    `CREATE TABLE "${TARGET_SYNC_SCHEMA}".intervals_expected AS SELECT * FROM "${TARGET_SYNC_SCHEMA}".intervals`,
  ),
);

for (const interval of await db.select().from(INTERVALS)) {
  const blocks: [number, number] = JSON.parse(interval.blocks.slice(1, -1));

  const chunks = getChunks({
    interval: blocks,
    maxChunkSize: Math.floor((blocks[1] - blocks[0]) / INTERVAL_CHUNKS),
  });

  const result: [number, number][] = [];

  const rng = seedrandom(SEED! + interval.fragmentId);

  for (const chunk of chunks) {
    if (rng() > INTERVAL_EVICT_RATE) {
      result.push(chunk);
    }
    // TODO(kyle) drop raw data from ponder_sync
  }

  if (result.length === 0) {
    await db
      .delete(INTERVALS)
      .where(eq(INTERVALS.fragmentId, interval.fragmentId));
  } else {
    const numranges = result
      .map((interval) => {
        const start = interval[0];
        const end = interval[1] + 1;
        return `numrange(${start}, ${end}, '[]')`;
      })
      .join(", ");

    await db
      .update(INTERVALS)
      .set({
        blocks: sql.raw(`nummultirange(${numranges})`),
      })
      .where(eq(INTERVALS.fragmentId, interval.fragmentId));
  }
}

process.env.DATABASE_SCHEMA = TARGET_SCHEMA;
process.env.DATABASE_URL = CONNECTION_STRING;
process.env.PONDER_TELEMETRY_DISABLED = "true";

const kill = await debug({
  cliOptions: {
    root: APP_DIR,
    command: "start",
    version: "0.0.0",
    config: "ponder.config.ts",
    logFormat: "pretty",
    // logLevel: "debug",
  },
  params: SIM_PARAMS,
  connectionString: CONNECTION_STRING,
});

// stop when no more events are possible: historical end or realtime finalized

while (true) {
  try {
    const response = await fetch("http://localhost:42069/ready");
    if (response.status === 200) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 50));
}

await new Promise((resolve) => setTimeout(resolve, 25_000));

console.log("KILLING");

await kill!();

// const schema = await import(`./${APP_DIR}/ponder.schema.ts`);
// for (const key of Object.keys(schema)) {
//   if (is(schema[key], Table)) {
//     const table = schema[key] as Table;
//     const tableName = getTableName(table);

//     await compareTables(
//       db,
//       `"${APP_ID}_expected"."${tableName}"`,
//       `"${TARGET_SCHEMA}"."${tableName}"`,
//     );
//   }
// }

await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${TARGET_SCHEMA}" CASCADE`));
await db.execute(
  sql.raw(`DROP SCHEMA IF EXISTS "${TARGET_SYNC_SCHEMA}" CASCADE`),
);
await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${APP_ID}_expected" CASCADE`));

await pool.end();
