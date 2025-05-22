import crypto from "node:crypto";
import { Table, eq, getTableName, is, sql } from "drizzle-orm";
import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import type { PgTable } from "drizzle-orm/pg-core";
import { customType, pgSchema } from "drizzle-orm/pg-core";
import seedrandom from "seedrandom";
import { custom, hexToNumber } from "viem";
import { start } from "../packages/core/src/bin/commands/start.js";
import { getPrimaryKeyColumns } from "../packages/core/src/drizzle/index.js";
import { createRpc } from "../packages/core/src/rpc/index.js";
import { getChunks } from "../packages/core/src/utils/interval.js";
import { promiseWithResolvers } from "../packages/core/src/utils/promiseWithResolvers.js";
import { _eth_getBlockByNumber } from "../packages/core/src/utils/rpc.js";
import { realtimeBlockEngine, sim } from "./rpc/index.js";

export type SimParams = {
  SEED: string;
  ERROR_RATE: number;
  ETH_GET_LOGS_RESPONSE_LIMIT: number;
  ETH_GET_LOGS_BLOCK_LIMIT: number;
  REALTIME_REORG_RATE: number;
  REALTIME_DEEP_REORG_RATE: number;
  REALTIME_FAST_FORWARD_RATE: number;
  REALTIME_DELAY_RATE: number;
  FINALIZED_RATE: number;
};

// inputs

const APP_ID = process.argv[2];
const APP_DIR = `./apps/${APP_ID}`;
const SEED = process.env.SEED ?? crypto.randomBytes(32).toString("hex");
const UUID = process.env.UUID ?? crypto.randomUUID();

if (APP_ID === undefined) {
  throw new Error("App ID is required. Example: 'pnpm test [app id]'");
}

// params

const INTERVAL_CHUNKS = 8;
const INTERVAL_EVICT_RATE = 0;
const SUPER_ASSESSMENT_FILTER_RATE = 0.5;

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
  FINALIZED_RATE: 0.95,
};

let db = drizzle(process.env.CONNECTION_STRING!, { casing: "snake_case" });

// 1. Setup database
//   - create database using template
//   - drop intervals deterministically
//   - [TODO] copy noisy data

await db.execute(sql.raw(`CREATE DATABASE "${UUID}" TEMPLATE "${APP_ID}"`));

db = drizzle(`${process.env.CONNECTION_STRING!}/${UUID}`, {
  casing: "snake_case",
});

await db.execute(
  sql.raw(
    "CREATE TABLE ponder_sync.expected_intervals AS SELECT * FROM ponder_sync.intervals",
  ),
);

const INTERVALS = pgSchema("ponder_sync").table("intervals", (t) => ({
  fragmentId: t.text().notNull().primaryKey(),
  chainId: t.bigint({ mode: "bigint" }).notNull(),
  blocks: customType<{ data: string }>({
    dataType() {
      return "nummultirange";
    },
  })().notNull(),
}));

for (const interval of await db.select().from(INTERVALS)) {
  const blocks: [number, number] = JSON.parse(interval.blocks.slice(1, -1));
  const chunks = getChunks({
    interval: [blocks[0], blocks[1] - 1],
    maxChunkSize: Math.floor((blocks[1] - blocks[0]) / INTERVAL_CHUNKS),
  });
  const resultIntervals: [number, number][] = [];
  const rng = seedrandom(SEED! + interval.fragmentId);
  for (const chunk of chunks) {
    if (rng() > INTERVAL_EVICT_RATE) {
      resultIntervals.push(chunk);
    } else {
      // TODO(kyle) cannot drop all logs in interval because they may be referenced by another interval
      // await db.execute(
      //   sql.raw(
      //     `DELETE FROM ponder_sync.blocks WHERE number >= ${chunk[0]} and number <= ${chunk[1]}`,
      //   ),
      // );
      // await db.execute(
      //   sql.raw(
      //     `DELETE FROM ponder_sync.transactions WHERE block_number >= ${chunk[0]} and block_number <= ${chunk[1]}`,
      //   ),
      // );
      // await db.execute(
      //   sql.raw(
      //     `DELETE FROM ponder_sync.transaction_receipts WHERE block_number >= ${chunk[0]} and block_number <= ${chunk[1]}`,
      //   ),
      // );
      // await db.execute(
      //   sql.raw(
      //     `DELETE FROM ponder_sync.traces WHERE block_number >= ${chunk[0]} and block_number <= ${chunk[1]}`,
      //   ),
      // );
      // await db.execute(
      //   sql.raw(
      //     `DELETE FROM ponder_sync.logs WHERE block_number >= ${chunk[0]} and block_number <= ${chunk[1]}`,
      //   ),
      // );
    }
  }
  if (resultIntervals.length === 0) {
    await db
      .delete(INTERVALS)
      .where(eq(INTERVALS.fragmentId, interval.fragmentId));
  } else {
    const numranges = resultIntervals
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

// 2. Write metadata

// 3. Run app

console.log({
  app: APP_ID,
  seed: SEED,
  uuid: UUID,
});

process.env.PONDER_TELEMETRY_DISABLED = "true";
process.env.DATABASE_URL = `${process.env.CONNECTION_STRING!}/${UUID}`;
process.env.DATABASE_SCHEMA = "public";

const pwr = promiseWithResolvers<void>();

const kill = await start({
  cliOptions: {
    root: APP_DIR,
    command: "start",
    version: "0.0.0",
    config: "ponder.config.ts",
    logFormat: "pretty",
    // logLevel: "debug",
  },
  onBuild: async (app) => {
    if (APP_ID === "super-assessment") {
      // TODO(kyle) remove some filters

      const r = seedrandom(`${SEED!}super-assessment`);

      app.indexingBuild.sources = app.indexingBuild.sources.filter(() => {
        if (r() < SUPER_ASSESSMENT_FILTER_RATE) {
          return false;
        }
        return true;
      });

      const chainsWithSources: typeof app.indexingBuild.chains = [];
      const rpcsWithSources: typeof app.indexingBuild.rpcs = [];
      const finalizedBlocksWithSources: typeof app.indexingBuild.finalizedBlocks =
        [];

      for (let i = 0; i < app.indexingBuild.chains.length; i++) {
        const chain = app.indexingBuild.chains[i]!;
        const rpc = app.indexingBuild.rpcs[i]!;
        const finalizedBlock = app.indexingBuild.finalizedBlocks[i]!;
        const hasSources = app.indexingBuild.sources.some(
          (source) => source.chain.name === chain.name,
        );
        if (hasSources) {
          chainsWithSources.push(chain);
          rpcsWithSources.push(rpc);
          finalizedBlocksWithSources.push(finalizedBlock);
        }
      }

      app.indexingBuild.chains = chainsWithSources;
      app.indexingBuild.rpcs = rpcsWithSources;
      app.indexingBuild.finalizedBlocks = finalizedBlocksWithSources;
    }

    const chains: Parameters<typeof realtimeBlockEngine>[0] = new Map();
    for (let i = 0; i < app.indexingBuild.chains.length; i++) {
      const chain = app.indexingBuild.chains[i]!;
      const rpc = app.indexingBuild.rpcs[i]!;

      // replace rpc with simulated transport

      chain.rpc = sim(
        custom({
          async request(body) {
            return rpc.request(body);
          },
        }),
        SIM_PARAMS,
        process.env.CONNECTION_STRING!,
      );

      app.indexingBuild.rpcs[i] = createRpc({
        common: app.common,
        chain,
        concurrency: Math.floor(
          app.common.options.rpcMaxConcurrency /
            app.indexingBuild.chains.length,
        ),
      });

      const start = Math.min(
        ...app.indexingBuild.sources.map(({ filter }) => filter.fromBlock ?? 0),
      );

      const end = Math.max(
        ...app.indexingBuild.sources.map(({ filter }) => filter.toBlock!),
      );

      app.indexingBuild.finalizedBlocks[i] = await _eth_getBlockByNumber(rpc, {
        blockNumber:
          start + Math.floor((end - start) * SIM_PARAMS.FINALIZED_RATE),
      });

      chains.set(chain.id, {
        // @ts-ignore
        request: rpc.request,
        interval: [
          hexToNumber(app.indexingBuild.finalizedBlocks[i]!.number) + 1,
          end,
        ],
      });

      app.common.logger.warn({
        service: "sim",
        msg: `Mocking eip1193 transport for chain '${chain.name}'`,
      });
    }

    const getRealtimeBlockGenerator = await realtimeBlockEngine(
      chains,
      SIM_PARAMS,
      process.env.CONNECTION_STRING!,
    );

    for (let i = 0; i < app.indexingBuild.chains.length; i++) {
      const chain = app.indexingBuild.chains[i]!;
      const rpc = app.indexingBuild.rpcs[i]!;

      rpc.subscribe = ({ onBlock }) => {
        (async () => {
          for await (const block of getRealtimeBlockGenerator(chain.id)) {
            // @ts-ignore
            await onBlock(block);
          }
          app.common.logger.warn({
            service: "sim",
            msg: `Realtime block subscription for chain '${chain.name}' completed`,
          });
          pwr.resolve();
        })();
      };

      app.common.logger.warn({
        service: "sim",
        msg: `Mocking realtime block subscription for chain '${chain.name}'`,
      });
    }

    return app;
  },
});

// stop when no more events are possible: historical end or realtime finalized

await pwr.promise;
await kill!();

// 4. Compare

const compareTables = async (
  db: NodePgDatabase,
  table: PgTable,
  expected: string,
  actual: string,
) => {
  const primaryKeys = getPrimaryKeyColumns(table).map((key) => key.sql);

  // missing or different rows
  const rows = await db.execute(
    sql.raw(
      `SELECT *, 1 as set FROM ${expected} EXCEPT SELECT *, 1 as set FROM ${actual} 
       UNION (SELECT *, 2 as set FROM ${actual} EXCEPT SELECT *, 2 as set FROM ${expected})
       LIMIT 25`,
    ),
  );
  // Note: different rows are double counted

  if (rows.rows.length > 0) {
    console.error(`ERROR: Failed database validation for ${actual}`);

    const result = new Map<
      string,
      {
        expected: Record<string, unknown> | undefined;
        actual: Record<string, unknown> | undefined;
      }
    >();

    for (const row of rows.rows) {
      const key = primaryKeys.map((key) => row[key]).join("_");

      if (result.has(key)) {
        if (row.set === 1) {
          result.get(key)!.expected = row;
        } else {
          result.get(key)!.actual = row;
        }
      } else {
        if (row.set === 1) {
          result.set(key, { expected: row, actual: undefined });
        } else {
          result.set(key, { expected: undefined, actual: row });
        }
      }

      // biome-ignore lint/performance/noDelete: <explanation>
      delete row.set;
    }

    console.table(
      Array.from(result).flatMap(([, { expected, actual }]) => {
        return [
          expected
            ? {
                type: "expected",
                ...Object.fromEntries(
                  Object.entries(expected).map(([key, value]) =>
                    primaryKeys.includes(key)
                      ? [`${key} (pk)`, value]
                      : [key, value],
                  ),
                ),
              }
            : {
                type: "expected",
              },
          actual
            ? {
                type: "actual",
                ...Object.fromEntries(
                  Object.entries(actual).map(([key, value]) =>
                    primaryKeys.includes(key)
                      ? [`${key} (pk)`, value]
                      : [key, value],
                  ),
                ),
              }
            : {
                type: "actual",
              },
        ];
      }),
    );
    console.log(`\nRecreate with 'SEED=${SEED} pnpm test ${APP_ID}'`);
    process.exit(1);
  }
};

const schema = await import(`./${APP_DIR}/ponder.schema.ts`);
for (const key of Object.keys(schema)) {
  if (is(schema[key], Table)) {
    const table = schema[key] as Table;
    const tableName = getTableName(table);

    await compareTables(db, table, `expected."${tableName}"`, `"${tableName}"`);
  }
}

await compareTables(
  db,
  INTERVALS,
  "ponder_sync.expected_intervals",
  "ponder_sync.intervals",
);

process.exit(0);
