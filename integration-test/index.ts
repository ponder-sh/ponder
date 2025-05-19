import { Table, eq, getTableName, is, sql } from "drizzle-orm";
import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import { customType, pgSchema } from "drizzle-orm/pg-core";
import seedrandom from "seedrandom";
import {
  type SimParams,
  debug,
} from "../packages/core/src/bin/commands/debug.js";
import { getChunks } from "../packages/core/src/utils/interval.js";
import { promiseWithResolvers } from "../packages/core/src/utils/promiseWithResolvers.js";

// inputs

const APP_DIR = "./apps/reference-erc20";
const APP_ID = "reference-erc20";
const SEED = "dff1a6a325d3ac4a42143e0d60aa1dc25dc69b19694dab3739eabc5c2aa5001e";
const CONNECTION_STRING = `${process.env.CONNECTION_STRING!}/${APP_ID}`;
const UUID = "1234567890";

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
  REALTIME_DEEP_REORG_RATE: 0.02,
  /** Probability that the chain fast forwards and skips a block. */
  REALTIME_FAST_FORWARD_RATE: 0.5,
  /** Probability that a block is delayed and a block on another chain is ordered first. */
  REALTIME_DELAY_RATE: 0.4,
  FINALIZED_RATE: 1,
};

const db = drizzle(CONNECTION_STRING, { casing: "snake_case" });

// 1. Setup ponder_sync schema
//   - create schema
//   - copy data from ponder_sync
//   - drop intervals deterministically
//   - copy extra data

await db.execute(sql.raw(`CREATE SCHEMA "${UUID}_sync"`));

const SYNC_TABLE_NAMES = [
  "blocks",
  "transactions",
  "transaction_receipts",
  "traces",
  "logs",
  "factories",
  "factory_addresses",
  "intervals",
  "rpc_request_results",
];

for (const table of SYNC_TABLE_NAMES) {
  await db.execute(
    sql.raw(
      `CREATE TABLE "${UUID}_sync"."${table}" (LIKE "ponder_sync"."${table}" INCLUDING ALL)`,
    ),
  );

  await db.execute(
    sql.raw(
      `INSERT INTO "${UUID}_sync"."${table}" OVERRIDING SYSTEM VALUE SELECT * FROM "ponder_sync"."${table}"`,
    ),
  );
}

await db.execute(
  sql.raw(
    `SELECT setval(pg_get_serial_sequence('"${UUID}_sync"."factories"', 'id'), (SELECT MAX(id) FROM "ponder_sync"."factories"))`,
  ),
);

await db.execute(
  sql.raw(
    `SELECT setval(pg_get_serial_sequence('"${UUID}_sync"."factory_addresses"', 'id'), (SELECT MAX(id) FROM "ponder_sync"."factory_addresses"))`,
  ),
);

const INTERVALS = pgSchema(`${UUID}_sync`).table("intervals", (t) => ({
  fragmentId: t.text().notNull().primaryKey(),
  chainId: t.bigint({ mode: "bigint" }).notNull(),
  blocks: customType<{ data: string }>({
    dataType() {
      return "nummultirange";
    },
  })().notNull(),
}));

// for (const interval of await db.select().from(INTERVALS)) {
//   const blocks: [number, number] = JSON.parse(interval.blocks.slice(1, -1));

//   const chunks = getChunks({
//     interval: blocks,
//     maxChunkSize: Math.floor((blocks[1] - blocks[0]) / INTERVAL_CHUNKS),
//   });

//   const resultIntervals: [number, number][] = [];

//   const rng = seedrandom(SEED! + interval.fragmentId);

//   for (const chunk of chunks) {
//     if (rng() > INTERVAL_EVICT_RATE) {
//       resultIntervals.push(chunk);
//     } else {
//       // TODO(kyle) cannot drop all logs in interval because they may be referenced by another interval
//       // await db.execute(
//       //   sql.raw(
//       //     `DELETE FROM "${UUID}_sync".blocks WHERE number >= ${chunk[0]} and number <= ${chunk[1]}`,
//       //   ),
//       // );
//       // await db.execute(
//       //   sql.raw(
//       //     `DELETE FROM "${UUID}_sync".transactions WHERE block_number >= ${chunk[0]} and block_number <= ${chunk[1]}`,
//       //   ),
//       // );
//       // await db.execute(
//       //   sql.raw(
//       //     `DELETE FROM "${UUID}_sync".transaction_receipts WHERE block_number >= ${chunk[0]} and block_number <= ${chunk[1]}`,
//       //   ),
//       // );
//       // await db.execute(
//       //   sql.raw(
//       //     `DELETE FROM "${UUID}_sync".traces WHERE block_number >= ${chunk[0]} and block_number <= ${chunk[1]}`,
//       //   ),
//       // );
//       // await db.execute(
//       //   sql.raw(
//       //     `DELETE FROM "${UUID}_sync".logs WHERE block_number >= ${chunk[0]} and block_number <= ${chunk[1]}`,
//       //   ),
//       // );
//     }
//   }

//   if (resultIntervals.length === 0) {
//     await db
//       .delete(INTERVALS)
//       .where(eq(INTERVALS.fragmentId, interval.fragmentId));
//   } else {
//     const numranges = resultIntervals
//       .map((interval) => {
//         const start = interval[0];
//         const end = interval[1] + 1;
//         return `numrange(${start}, ${end}, '[]')`;
//       })
//       .join(", ");

//     await db
//       .update(INTERVALS)
//       .set({
//         blocks: sql.raw(`nummultirange(${numranges})`),
//       })
//       .where(eq(INTERVALS.fragmentId, interval.fragmentId));
//   }
// }

// 2. Write metadata
// 3. Run app

process.env.DATABASE_SCHEMA = UUID;
process.env.DATABASE_URL = CONNECTION_STRING;
process.env.PONDER_TELEMETRY_DISABLED = "true";

const pwr = promiseWithResolvers<void>();

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
  rpcConnectionString: process.env.CONNECTION_STRING!,
  onReady: () => {},
  onComplete: () => {
    pwr.resolve();
  },
});

// stop when no more events are possible: historical end or realtime finalized

await pwr.promise;
await kill!();

// 4. Compare

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

const schema = await import(`./${APP_DIR}/ponder.schema.ts`);
for (const key of Object.keys(schema)) {
  if (is(schema[key], Table)) {
    const table = schema[key] as Table;
    const tableName = getTableName(table);

    await compareTables(
      db,
      `expected."${tableName}"`,
      `"${UUID}"."${tableName}"`,
    );
  }
}

// TODO(kyle) compare intervals table (maybe all ponder_sync) ??

process.exit(0);
