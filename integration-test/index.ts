import crypto from "node:crypto";
import { Table, eq, getTableName, is, sql } from "drizzle-orm";
import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import type { PgTable } from "drizzle-orm/pg-core";
import { customType, pgSchema } from "drizzle-orm/pg-core";
import { and } from "ponder";
import seedrandom from "seedrandom";
import { custom, hexToNumber } from "viem";
import { start } from "../packages/core/src/bin/commands/start.js";
import { getPrimaryKeyColumns } from "../packages/core/src/drizzle/index.js";
import { createRpc } from "../packages/core/src/rpc/index.js";
import {
  blockFilter,
  logFilter,
  traceFilter,
  transactionFilter,
  transferFilter,
} from "../packages/core/src/sync-store/index.js";
import * as PONDER_SYNC from "../packages/core/src/sync-store/schema.js";
import { getChunks } from "../packages/core/src/utils/interval.js";
import { promiseWithResolvers } from "../packages/core/src/utils/promiseWithResolvers.js";
import { _eth_getBlockByNumber } from "../packages/core/src/utils/rpc.js";
import { realtimeBlockEngine, sim } from "./rpc/index.js";

// inputs

const DATABASE_URL = process.env.DATABASE_URL!;
const APP_ID = process.argv[2];
const APP_DIR = `./apps/${APP_ID}`;
export const SEED = process.env.SEED ?? crypto.randomBytes(32).toString("hex");
export const UUID = process.env.UUID ?? crypto.randomUUID();

if (APP_ID === undefined) {
  throw new Error("App ID is required. Example: 'pnpm test [app id]'");
}

// params

export const pick = <T>(possibilities: T[] | readonly T[], tag: string): T => {
  return possibilities[
    Math.floor(possibilities.length * seedrandom(SEED + tag)())
  ]!;
};

export const ERROR_RATE = pick([0, 0.02, 0.05, 0.1, 0.2], "error-rate");
export const INTERVAL_CHUNKS = 8;
export const INTERVAL_EVICT_RATE = pick(
  [0, 0.25, 0.5, 0.75, 1],
  "interval-evict-rate",
);
export const SUPER_ASSESSMENT_FILTER_RATE = pick(
  [0, 0.25, 0.5, 0.75, 1],
  "super-assessment-filter-rate",
);
export const ETH_GET_LOGS_RESPONSE_LIMIT = pick(
  [100, 1000, 10_000, Number.POSITIVE_INFINITY],
  "eth-get-logs-response-limit",
);
export const ETH_GET_LOGS_BLOCK_LIMIT = pick(
  [100, 1000, 10_000, Number.POSITIVE_INFINITY],
  "eth-get-logs-block-limit",
);
export const REALTIME_REORG_RATE = pick(
  [0, 0.02, 0.05, 0.1],
  "realtime-reorg-rate",
);
export const REALTIME_DEEP_REORG_RATE = pick(
  [0, 0.02, 0.05, 0.1],
  "realtime-deep-reorg-rate",
);
export const REALTIME_FAST_FORWARD_RATE = pick(
  [0, 0.25, 0.5, 0.75],
  "realtime-fast-forward-rate",
);
export const REALTIME_DELAY_RATE = pick([0, 0.4, 0.8], "realtime-delay-rate");
export const FINALIZED_RATE = pick([0, 0.8, 0.9, 0.95, 1], "finalized-rate");

let db = drizzle(DATABASE_URL!, { casing: "snake_case" });

// 1. Setup database
//   - create database using template
//   - drop intervals deterministically
//   - [TODO] copy noisy data

await db.execute(sql.raw(`CREATE DATABASE "${UUID}" TEMPLATE "${APP_ID}"`));

db = drizzle(`${DATABASE_URL!}/${UUID}`, { casing: "snake_case" });

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
  // TODO(kyle) support multiple intervals
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
process.env.DATABASE_URL = `${DATABASE_URL!}/${UUID}`;
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
      const r = seedrandom(SEED);

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

      const expected = pgSchema("expected").table("events", (t) => ({
        chainId: t.bigint({ mode: "number" }).notNull(),
        name: t.text().notNull(),
        id: t.varchar({ length: 75 }).notNull(),
      }));

      await db.execute(sql.raw("CREATE SCHEMA expected"));
      await db.execute(
        sql.raw(
          `CREATE TABLE expected.events (
            chain_id BIGINT NOT NULL,
            name TEXT NOT NULL,
            id VARCHAR(75) NOT NULL,
            CONSTRAINT "events_pk" PRIMARY KEY("name","id")
          )`,
        ),
      );
      for (const { filter, name } of app.indexingBuild.sources) {
        switch (filter.type) {
          case "block": {
            const blockCheckpoint = sql.raw(
              `
            (lpad(blocks.timestamp::text, 10, '0') ||
            lpad(blocks.chain_id::text, 16, '0') ||
            lpad(blocks.number::text, 16, '0') ||
            '9999999999999999' ||
            '5' ||
            '0000000000000000')`,
            );

            const blocksQuery = db
              .select({
                chainId: sql.raw(filter.chainId).as("chain_id"),
                name: sql.raw(`'${name}:block'`).as("name"),
                id: blockCheckpoint.as("id"),
              })
              .from(PONDER_SYNC.blocks)
              .where(
                and(
                  eq(PONDER_SYNC.blocks.chainId, filter.chainId),
                  blockFilter(filter),
                ),
              );

            await db.insert(expected).select(blocksQuery);

            break;
          }
          case "transaction": {
            const transactionCheckpoint = sql.raw(
              `
            (lpad(blocks.timestamp::text, 10, '0') ||
            lpad(transactions.chain_id::text, 16, '0') ||
            lpad(transactions.block_number::text, 16, '0') ||
            lpad(transactions.transaction_index::text, 16, '0') ||
            '2' ||
            '0000000000000000')`,
            );

            const isFrom = filter.toAddress === undefined;
            const transactionsQuery = db
              .select({
                chainId: sql.raw(filter.chainId).as("chain_id"),
                name: sql
                  .raw(`'${name}:transaction:${isFrom ? "from" : "to"}'`)
                  .as("name"),
                id: transactionCheckpoint.as("id"),
              })
              .from(PONDER_SYNC.transactions)
              .innerJoin(
                PONDER_SYNC.blocks,
                and(
                  eq(
                    PONDER_SYNC.blocks.chainId,
                    PONDER_SYNC.transactions.chainId,
                  ),
                  eq(
                    PONDER_SYNC.blocks.number,
                    PONDER_SYNC.transactions.blockNumber,
                  ),
                ),
              )
              .where(
                and(
                  eq(PONDER_SYNC.transactions.chainId, filter.chainId),
                  transactionFilter(filter),
                ),
              );

            await db.insert(expected).select(transactionsQuery);

            break;
          }
          case "trace": {
            const traceCheckpoint = sql.raw(
              `
            (lpad(blocks.timestamp::text, 10, '0') ||
            lpad(traces.chain_id::text, 16, '0') ||
            lpad(traces.block_number::text, 16, '0') ||
            lpad(traces.transaction_index::text, 16, '0') ||
            '7' ||
            lpad(traces.trace_index::text, 16, '0'))`,
            );

            const tracesQuery = db
              .select({
                chainId: sql.raw(filter.chainId).as("chain_id"),
                name: sql.raw(`'${name}.transfer()'`).as("name"),
                id: traceCheckpoint.as("id"),
              })
              .from(PONDER_SYNC.traces)
              .innerJoin(
                PONDER_SYNC.blocks,
                and(
                  eq(PONDER_SYNC.blocks.chainId, PONDER_SYNC.traces.chainId),
                  eq(PONDER_SYNC.blocks.number, PONDER_SYNC.traces.blockNumber),
                ),
              )
              .where(
                and(
                  eq(PONDER_SYNC.traces.chainId, filter.chainId),
                  traceFilter(filter),
                ),
              );

            await db.insert(expected).select(tracesQuery);

            break;
          }
          case "log": {
            const logCheckpoint = sql.raw(
              `
            (lpad(blocks.timestamp::text, 10, '0') ||
            lpad(logs.chain_id::text, 16, '0') ||
            lpad(logs.block_number::text, 16, '0') ||
            lpad(logs.transaction_index::text, 16, '0') ||
            '5' ||
            lpad(logs.log_index::text, 16, '0'))`,
            );

            const logsQuery = db
              .select({
                chainId: sql.raw(filter.chainId).as("chain_id"),
                name: sql.raw(`'${name}:Transfer'`).as("name"),
                id: logCheckpoint.as("id"),
              })
              .from(PONDER_SYNC.logs)
              .innerJoin(
                PONDER_SYNC.blocks,
                and(
                  eq(PONDER_SYNC.blocks.chainId, PONDER_SYNC.logs.chainId),
                  eq(PONDER_SYNC.blocks.number, PONDER_SYNC.logs.blockNumber),
                ),
              )
              .where(
                and(
                  eq(PONDER_SYNC.logs.chainId, filter.chainId),
                  logFilter(filter),
                ),
              );

            await db.insert(expected).select(logsQuery);

            break;
          }
          case "transfer": {
            const transferCheckpoint = sql.raw(
              `
              (lpad(blocks.timestamp::text, 10, '0') ||
              lpad(traces.chain_id::text, 16, '0') ||
              lpad(traces.block_number::text, 16, '0') ||
              lpad(traces.transaction_index::text, 16, '0') ||
              '7' ||
              lpad(traces.trace_index::text, 16, '0'))`,
            );

            const isFrom = filter.toAddress === undefined;
            const transfersQuery = db
              .select({
                chainId: sql.raw(filter.chainId).as("chain_id"),
                name: sql
                  .raw(`'${name}:transfer:${isFrom ? "from" : "to"}'`)
                  .as("name"),
                id: transferCheckpoint.as("id"),
              })
              .from(PONDER_SYNC.traces)
              .innerJoin(
                PONDER_SYNC.blocks,
                and(
                  eq(PONDER_SYNC.blocks.chainId, PONDER_SYNC.traces.chainId),
                  eq(PONDER_SYNC.blocks.number, PONDER_SYNC.traces.blockNumber),
                ),
              )
              .where(
                and(
                  eq(PONDER_SYNC.traces.chainId, filter.chainId),
                  transferFilter(filter),
                ),
              );

            await db.insert(expected).select(transfersQuery);

            break;
          }
        }
      }
    }

    const chains: Parameters<typeof realtimeBlockEngine>[0] = new Map();
    for (let i = 0; i < app.indexingBuild.chains.length; i++) {
      const chain = app.indexingBuild.chains[i]!;
      const rpc = app.indexingBuild.rpcs[i]!;

      const start = Math.min(
        ...app.indexingBuild.sources.map(({ filter }) => filter.fromBlock ?? 0),
      );

      const end = Math.max(
        ...app.indexingBuild.sources.map(({ filter }) => filter.toBlock!),
      );

      app.indexingBuild.finalizedBlocks[i] = await _eth_getBlockByNumber(rpc, {
        blockNumber: start + Math.floor((end - start) * FINALIZED_RATE),
      });

      // replace rpc with simulated transport

      chain.rpc = sim(
        custom({
          async request(body) {
            return rpc.request(body);
          },
        }),
        DATABASE_URL!,
      );

      app.indexingBuild.rpcs[i] = createRpc({
        common: app.common,
        chain,
        concurrency: Math.floor(
          app.common.options.rpcMaxConcurrency /
            app.indexingBuild.chains.length,
        ),
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
      DATABASE_URL!,
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

// await compareTables(
//   db,
//   INTERVALS,
//   "ponder_sync.expected_intervals",
//   "ponder_sync.intervals",
// );

process.exit(0);
