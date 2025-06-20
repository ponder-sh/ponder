import crypto from "node:crypto";
import { $ } from "bun";
import { Command } from "commander";
import {
  type SQL,
  Table,
  and,
  eq,
  exists,
  getTableName,
  gt,
  gte,
  inArray,
  is,
  isNotNull,
  isNull,
  lte,
  not,
  or,
  sql,
} from "drizzle-orm";
import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import seedrandom from "seedrandom";
import { type Address, type RpcBlock, custom, hexToNumber } from "viem";
import packageJson from "../../packages/core/package.json" assert {
  type: "json",
};
import {
  type PonderApp,
  start,
} from "../../packages/core/src/bin/commands/start.js";
import { createQB } from "../../packages/core/src/database/queryBuilder.js";
import { getPrimaryKeyColumns } from "../../packages/core/src/drizzle/index.js";
import type {
  Factory,
  FragmentAddress,
} from "../../packages/core/src/internal/types.js";
import { createRpc } from "../../packages/core/src/rpc/index.js";
import * as PONDER_SYNC from "../../packages/core/src/sync-store/schema.js";
import {
  decodeFragment,
  getFragments,
  isFragmentAddressFactory,
} from "../../packages/core/src/sync/fragments.js";
import {
  getChunks,
  intervalUnion,
} from "../../packages/core/src/utils/interval.js";
import { promiseWithResolvers } from "../../packages/core/src/utils/promiseWithResolvers.js";
import { _eth_getBlockByNumber } from "../../packages/core/src/utils/rpc.js";
import * as SUPER_ASSESSMENT from "../apps/super-assessment/schema.js";
import { metadata } from "../schema.js";
import { dbSim } from "./db-sim";
import { type RpcBlockHeader, realtimeBlockEngine, sim } from "./rpc-sim.js";
import { getJoinConditions } from "./sql.js";

// Large apps that shouldn't be synced, use cached data instead
const CACHED_APPS = ["the-compact", "basepaint"];

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

export const SIM_PARAMS = {
  RPC_ERROR_RATE: pick([0, 0.02, 0.05, 0.1, 0.2], "rpc-error-rate"),
  DB_ERROR_RATE: pick([0, 0.02, 0.05, 0.1, 0.2], "db-error-rate"),
  MAX_UNCACHED_BLOCKS: CACHED_APPS.includes(APP_ID)
    ? 0
    : pick([0, 0, 0, 100, 1000], "max-uncached-blocks"),
  SUPER_ASSESSMENT_FILTER_RATE: pick(
    [0, 0.25, 0.5],
    "super-assessment-filter-rate",
  ),
  ETH_GET_LOGS_RESPONSE_LIMIT: pick(
    [1000, 10_000, Number.POSITIVE_INFINITY],
    "eth-get-logs-response-limit",
  ),
  ETH_GET_LOGS_BLOCK_LIMIT: pick(
    [100, 1000, 10_000, Number.POSITIVE_INFINITY],
    "eth-get-logs-block-limit",
  ),
  REALTIME_REORG_RATE: pick([0, 0.02, 0.05, 0.1], "realtime-reorg-rate"),
  REALTIME_DEEP_REORG_RATE: pick([0, 0.02, 0.04], "realtime-deep-reorg-rate"),
  REALTIME_FAST_FORWARD_RATE: pick(
    [0, 0.25, 0.5, 0.75],
    "realtime-fast-forward-rate",
  ),
  REALTIME_DELAY_RATE: pick([0, 0.4, 0.8], "realtime-delay-rate"),
  UNFINALIZED_BLOCKS: pick([0, 0, 100, 100, 1000, 1100], "unfinalized-blocks"),
  // SHUTDOWN_TIMER: pick(
  //   [
  //     undefined,
  //     () => new Promise((resolve) => setTimeout(resolve, 1000)),
  //     () => new Promise((resolve) => setTimeout(resolve, 5000)),
  //   ],
  //   "shutdown",
  // ),
  // REALTIME_SHUTDOWN_RATE: pick([0, 0.001, 0.002], "realtime-shutdown-rate"),
  ORDERING: pick(["multichain", "omnichain"], "ordering"),
  REALTIME_BLOCK_HAS_TRANSACTIONS: pick(
    [true, false],
    "realtime-block-has-transactions",
  ),
};

const db = drizzle(DATABASE_URL!, { casing: "snake_case" });

// 1. Setup database

await db.execute(sql.raw(`CREATE DATABASE "${UUID}" TEMPLATE "${APP_ID}"`));

const appDb = drizzle(`${DATABASE_URL!}/${UUID}`, { casing: "snake_case" });

await appDb.execute(
  sql.raw(
    "CREATE TABLE ponder_sync.expected_intervals AS SELECT * FROM ponder_sync.intervals",
  ),
);

const blockConditions: SQL[] = [];
const transactionConditions: SQL[] = [];
const transactionReceiptConditions: SQL[] = [];
const traceConditions: SQL[] = [];
const logConditions: SQL[] = [];

const getAddressCondition = <
  table extends
    | typeof PONDER_SYNC.logs
    | typeof PONDER_SYNC.traces
    | typeof PONDER_SYNC.transactions,
>(
  fragmentAddress: FragmentAddress,
  table: table,
  column: keyof table,
  filterAddress?: Address | Address[] | Factory | undefined,
): SQL => {
  const addressColumn = table[column] as PgColumn;
  if (isFragmentAddressFactory(fragmentAddress)) {
    if (filterAddress === undefined) return sql`true`;

    return inArray(
      addressColumn,
      appDb
        .select({ address: PONDER_SYNC.factoryAddresses.address })
        .from(PONDER_SYNC.factoryAddresses)
        .where(
          and(
            gte(table.blockNumber, PONDER_SYNC.factoryAddresses.blockNumber),
            eq(
              PONDER_SYNC.factoryAddresses.factoryId,
              appDb
                .select({ id: PONDER_SYNC.factories.id })
                .from(PONDER_SYNC.factories)
                .where(
                  eq(PONDER_SYNC.factories.factory, filterAddress as Factory),
                ),
            ),
          ),
        ),
    );
  } else if (typeof fragmentAddress === "string") {
    return eq(addressColumn, fragmentAddress);
  } else {
    return sql`true`;
  }
};

// 2. Write metadata

const branch = await $`git rev-parse --abbrev-ref HEAD`.text();
const commit = await $`git rev-parse HEAD`.text();

await db.insert(metadata).values({
  id: UUID,
  seed: SEED,
  app: APP_ID,
  commit: branch.trim(),
  branch: commit.trim(),
  version: packageJson.version,
  ci: process.env.CI === "true",
  time: sql`now()`,
  success: false,
});

// 3. Run app

console.log({
  app: APP_ID,
  seed: SEED,
  uuid: UUID,
  ...SIM_PARAMS,
});

const program = new Command()
  .option(
    "-v, --debug",
    "Enable debug logs, e.g. realtime blocks, internal events",
  )
  .option(
    "-vv, --trace",
    "Enable trace logs, e.g. db queries, indexing checkpoints",
  )
  .option(
    "--log-level <LEVEL>",
    'Minimum log level ("error", "warn", "info", "debug", or "trace", default: "info")',
  )
  .option(
    "--log-format <FORMAT>",
    'The log format ("pretty" or "json")',
    "pretty",
  )
  .parse(process.argv);

process.env.PONDER_TELEMETRY_DISABLED = "true";
process.env.DATABASE_URL = `${DATABASE_URL!}/${UUID}`;
process.env.DATABASE_SCHEMA = "public";
process.env.SEED = SEED;

const pwr = promiseWithResolvers<void>();

/**
 * Simulation testing plugin.
 *
 * 1. Build super-assessment expected tables
 * 2. Remove uncached and unfinalized data
 * 3. Replace finalized block
 * 4. Replace rpc with simulated rpc
 */
const onBuild = async (app: PonderApp) => {
  app.preBuild.ordering = SIM_PARAMS.ORDERING;

  app.common.logger.warn({
    service: "sim",
    msg: "Mocking syncQB, adminQB, userQB, and readonlyQB",
  });

  // const syncDB = dbSim(drizzle(DATABASE_URL!, { casing: "snake_case" }));
  // const adminDB = dbSim(drizzle(DATABASE_URL!, { casing: "snake_case" }));
  // const userDB = dbSim(drizzle(DATABASE_URL!, { casing: "snake_case" }));
  // const readonlyDB = dbSim(drizzle(DATABASE_URL!, { casing: "snake_case" }));

  app.database.syncQB = createQB(
    () => dbSim(drizzle(app.database.driver.sync!, { casing: "snake_case" })),
    { common: app.common },
  );

  app.database.adminQB = createQB(
    () => dbSim(drizzle(app.database.driver.admin!, { casing: "snake_case" })),
    {
      common: app.common,
      isAdmin: true,
    },
  );

  app.database.userQB = createQB(
    () => dbSim(drizzle(app.database.driver.user!, { casing: "snake_case" })),
    { common: app.common },
  );

  app.database.readonlyQB = createQB(
    () =>
      dbSim(drizzle(app.database.driver.readonly!, { casing: "snake_case" })),
    { common: app.common },
  );

  if (APP_ID === "super-assessment") {
    const random = seedrandom(`${SEED}_super_assessment_filter`);
    app.indexingBuild.sources = app.indexingBuild.sources.filter(() => {
      if (random() < SIM_PARAMS.SUPER_ASSESSMENT_FILTER_RATE) {
        return false;
      }
      return true;
    });

    if (app.indexingBuild.sources.length === 0) {
      console.error("Invalid app configuration: no sources");
      process.exit(0);
    }

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

    // build super assessment expected tables

    await migrate(appDb, {
      migrationsFolder: "./apps/super-assessment/migrations",
    });

    for (const source of app.indexingBuild.sources) {
      const filter = source.filter;
      const blockConditions = [
        filter.fromBlock
          ? gte(PONDER_SYNC.blocks.number, BigInt(filter.fromBlock))
          : undefined,
        filter.toBlock
          ? lte(PONDER_SYNC.blocks.number, BigInt(filter.toBlock))
          : undefined,
      ];

      for (const { fragment } of getFragments(filter)) {
        switch (fragment.type) {
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

            await appDb.insert(SUPER_ASSESSMENT.blocks).select(
              appDb
                .select({
                  name: sql.raw(`'${source.name}:block'`).as("name"),
                  id: blockCheckpoint.as("id"),
                  chainId: PONDER_SYNC.blocks.chainId,
                  number: PONDER_SYNC.blocks.number,
                  hash: PONDER_SYNC.blocks.hash,
                })
                .from(PONDER_SYNC.blocks)
                .where(
                  and(
                    eq(PONDER_SYNC.blocks.chainId, BigInt(fragment.chainId)),
                    sql`(blocks.number - ${fragment.offset}) % ${fragment.interval} = 0`,
                    ...blockConditions,
                  ),
                ),
            );

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

            const condition = and(
              eq(PONDER_SYNC.transactions.chainId, BigInt(fragment.chainId)),
              getAddressCondition(
                fragment.fromAddress,
                PONDER_SYNC.transactions,
                "from",
                filter.fromAddress,
              ),
              getAddressCondition(
                fragment.toAddress,
                PONDER_SYNC.transactions,
                "to",
                filter.toAddress,
              ),
              eq(PONDER_SYNC.transactionReceipts.status, "0x1"),
              ...blockConditions,
            );

            const isFrom = fragment.toAddress === null;

            await appDb.insert(SUPER_ASSESSMENT.blocks).select(
              appDb
                .select({
                  name: sql
                    .raw(
                      `'${source.name}:transaction:${isFrom ? "from" : "to"}'`,
                    )
                    .as("name"),
                  id: transactionCheckpoint.as("id"),
                  chainId: PONDER_SYNC.transactions.chainId,
                  number: PONDER_SYNC.blocks.number,
                  hash: PONDER_SYNC.blocks.hash,
                })
                .from(PONDER_SYNC.transactions)
                .innerJoin(
                  PONDER_SYNC.blocks,
                  getJoinConditions(
                    PONDER_SYNC.blocks,
                    PONDER_SYNC.transactions,
                  ),
                )
                .innerJoin(
                  PONDER_SYNC.transactionReceipts,
                  getJoinConditions(
                    PONDER_SYNC.transactionReceipts,
                    PONDER_SYNC.transactions,
                  ),
                )
                .where(condition),
            );

            await appDb.insert(SUPER_ASSESSMENT.transactions).select(
              appDb
                .select({
                  name: sql
                    .raw(
                      `'${source.name}:transaction:${isFrom ? "from" : "to"}'`,
                    )
                    .as("name"),
                  id: transactionCheckpoint.as("id"),
                  chainId: PONDER_SYNC.transactions.chainId,
                  transactionIndex: PONDER_SYNC.transactions.transactionIndex,
                  hash: PONDER_SYNC.transactions.hash,
                })
                .from(PONDER_SYNC.transactions)
                .innerJoin(
                  PONDER_SYNC.blocks,
                  getJoinConditions(
                    PONDER_SYNC.blocks,
                    PONDER_SYNC.transactions,
                  ),
                )
                .innerJoin(
                  PONDER_SYNC.transactionReceipts,
                  getJoinConditions(
                    PONDER_SYNC.transactionReceipts,
                    PONDER_SYNC.transactions,
                  ),
                )
                .where(condition),
            );

            await appDb.insert(SUPER_ASSESSMENT.transactionReceipts).select(
              appDb
                .select({
                  name: sql
                    .raw(
                      `'${source.name}:transaction:${isFrom ? "from" : "to"}'`,
                    )
                    .as("name"),
                  id: transactionCheckpoint.as("id"),
                  chainId: PONDER_SYNC.transactions.chainId,
                  transactionIndex:
                    PONDER_SYNC.transactionReceipts.transactionIndex,
                  hash: PONDER_SYNC.transactionReceipts.transactionHash,
                })
                .from(PONDER_SYNC.transactions)
                .innerJoin(
                  PONDER_SYNC.blocks,
                  getJoinConditions(
                    PONDER_SYNC.blocks,
                    PONDER_SYNC.transactions,
                  ),
                )
                .innerJoin(
                  PONDER_SYNC.transactionReceipts,
                  getJoinConditions(
                    PONDER_SYNC.transactionReceipts,
                    PONDER_SYNC.transactions,
                  ),
                )
                .where(condition),
            );

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

            const condition = and(
              eq(PONDER_SYNC.traces.chainId, BigInt(fragment.chainId)),
              getAddressCondition(
                fragment.fromAddress,
                PONDER_SYNC.traces,
                "from",
                filter.fromAddress,
              ),
              getAddressCondition(
                fragment.toAddress,
                PONDER_SYNC.traces,
                "to",
                filter.toAddress,
              ),
              filter.includeReverted
                ? undefined
                : isNull(PONDER_SYNC.traces.error),
              filter.callType
                ? eq(PONDER_SYNC.traces.type, filter.callType)
                : undefined,
              fragment.functionSelector
                ? eq(
                    sql`substring(traces.input from 1 for 10)`,
                    fragment.functionSelector,
                  )
                : undefined,
              ...blockConditions,
            );

            await appDb.insert(SUPER_ASSESSMENT.blocks).select(
              appDb
                .select({
                  name: sql.raw(`'${source.name}.transfer()'`).as("name"),
                  id: traceCheckpoint.as("id"),
                  chainId: PONDER_SYNC.traces.chainId,
                  number: PONDER_SYNC.blocks.number,
                  hash: PONDER_SYNC.blocks.hash,
                })
                .from(PONDER_SYNC.traces)
                .innerJoin(
                  PONDER_SYNC.blocks,
                  getJoinConditions(PONDER_SYNC.blocks, PONDER_SYNC.traces),
                )
                .where(condition),
            );

            await appDb.insert(SUPER_ASSESSMENT.transactions).select(
              appDb
                .select({
                  name: sql.raw(`'${source.name}.transfer()'`).as("name"),
                  id: traceCheckpoint.as("id"),
                  chainId: PONDER_SYNC.traces.chainId,
                  transactionIndex: PONDER_SYNC.transactions.transactionIndex,
                  hash: PONDER_SYNC.transactions.hash,
                })
                .from(PONDER_SYNC.traces)
                .innerJoin(
                  PONDER_SYNC.blocks,
                  getJoinConditions(PONDER_SYNC.blocks, PONDER_SYNC.traces),
                )
                .innerJoin(
                  PONDER_SYNC.transactions,
                  getJoinConditions(
                    PONDER_SYNC.transactions,
                    PONDER_SYNC.traces,
                  ),
                )
                .where(condition),
            );

            if (fragment.includeTransactionReceipts) {
              await appDb.insert(SUPER_ASSESSMENT.transactionReceipts).select(
                appDb
                  .select({
                    name: sql.raw(`'${source.name}.transfer()'`).as("name"),
                    id: traceCheckpoint.as("id"),
                    chainId: PONDER_SYNC.traces.chainId,
                    transactionIndex:
                      PONDER_SYNC.transactionReceipts.transactionIndex,
                    hash: PONDER_SYNC.transactionReceipts.transactionHash,
                  })
                  .from(PONDER_SYNC.traces)
                  .innerJoin(
                    PONDER_SYNC.blocks,
                    getJoinConditions(PONDER_SYNC.blocks, PONDER_SYNC.traces),
                  )
                  .innerJoin(
                    PONDER_SYNC.transactionReceipts,
                    getJoinConditions(
                      PONDER_SYNC.transactionReceipts,
                      PONDER_SYNC.traces,
                    ),
                  )
                  .where(condition),
              );
            }

            await appDb.insert(SUPER_ASSESSMENT.traces).select(
              appDb
                .select({
                  name: sql.raw(`'${source.name}.transfer()'`).as("name"),
                  id: traceCheckpoint.as("id"),
                  chainId: PONDER_SYNC.traces.chainId,
                  traceIndex: PONDER_SYNC.traces.traceIndex,
                })
                .from(PONDER_SYNC.traces)
                .innerJoin(
                  PONDER_SYNC.blocks,
                  getJoinConditions(PONDER_SYNC.blocks, PONDER_SYNC.traces),
                )
                .where(condition),
            );

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

            const condition = and(
              eq(PONDER_SYNC.logs.chainId, BigInt(fragment.chainId)),
              getAddressCondition(
                fragment.address,
                PONDER_SYNC.logs,
                "address",
                filter.address,
              ),
              fragment.topic0
                ? eq(PONDER_SYNC.logs.topic0, fragment.topic0)
                : undefined,
              fragment.topic1
                ? eq(PONDER_SYNC.logs.topic1, fragment.topic1)
                : undefined,
              fragment.topic2
                ? eq(PONDER_SYNC.logs.topic2, fragment.topic2)
                : undefined,
              fragment.topic3
                ? eq(PONDER_SYNC.logs.topic3, fragment.topic3)
                : undefined,
              ...blockConditions,
            );

            await appDb.insert(SUPER_ASSESSMENT.blocks).select(
              appDb
                .select({
                  name: sql.raw(`'${source.name}:Transfer'`).as("name"),
                  id: logCheckpoint.as("id"),
                  chainId: PONDER_SYNC.logs.chainId,
                  number: PONDER_SYNC.blocks.number,
                  hash: PONDER_SYNC.blocks.hash,
                })
                .from(PONDER_SYNC.logs)
                .innerJoin(
                  PONDER_SYNC.blocks,
                  getJoinConditions(PONDER_SYNC.blocks, PONDER_SYNC.logs),
                )
                .where(condition),
            );

            await appDb.insert(SUPER_ASSESSMENT.transactions).select(
              appDb
                .select({
                  name: sql.raw(`'${source.name}:Transfer'`).as("name"),
                  id: logCheckpoint.as("id"),
                  chainId: PONDER_SYNC.logs.chainId,
                  transactionIndex: PONDER_SYNC.transactions.transactionIndex,
                  hash: PONDER_SYNC.transactions.hash,
                })
                .from(PONDER_SYNC.logs)
                .innerJoin(
                  PONDER_SYNC.blocks,
                  getJoinConditions(PONDER_SYNC.blocks, PONDER_SYNC.logs),
                )
                .innerJoin(
                  PONDER_SYNC.transactions,
                  getJoinConditions(PONDER_SYNC.transactions, PONDER_SYNC.logs),
                )
                .where(condition),
            );

            if (fragment.includeTransactionReceipts) {
              await appDb.insert(SUPER_ASSESSMENT.transactionReceipts).select(
                appDb
                  .select({
                    name: sql.raw(`'${source.name}:Transfer'`).as("name"),
                    id: logCheckpoint.as("id"),
                    chainId: PONDER_SYNC.logs.chainId,
                    transactionIndex:
                      PONDER_SYNC.transactionReceipts.transactionIndex,
                    hash: PONDER_SYNC.transactionReceipts.transactionHash,
                  })
                  .from(PONDER_SYNC.logs)
                  .innerJoin(
                    PONDER_SYNC.blocks,
                    getJoinConditions(PONDER_SYNC.blocks, PONDER_SYNC.logs),
                  )
                  .innerJoin(
                    PONDER_SYNC.transactionReceipts,
                    getJoinConditions(
                      PONDER_SYNC.transactionReceipts,
                      PONDER_SYNC.logs,
                    ),
                  )
                  .where(condition),
              );
            }

            await appDb.insert(SUPER_ASSESSMENT.logs).select(
              appDb
                .select({
                  name: sql.raw(`'${source.name}:Transfer'`).as("name"),
                  id: logCheckpoint.as("id"),
                  chainId: PONDER_SYNC.logs.chainId,
                  logIndex: PONDER_SYNC.logs.logIndex,
                })
                .from(PONDER_SYNC.logs)
                .innerJoin(
                  PONDER_SYNC.blocks,
                  getJoinConditions(PONDER_SYNC.blocks, PONDER_SYNC.logs),
                )
                .where(condition),
            );

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

            const condition = and(
              eq(PONDER_SYNC.traces.chainId, BigInt(fragment.chainId)),
              getAddressCondition(
                fragment.fromAddress,
                PONDER_SYNC.traces,
                "from",
                filter.fromAddress,
              ),
              getAddressCondition(
                fragment.toAddress,
                PONDER_SYNC.traces,
                "to",
                filter.toAddress,
              ),
              isNotNull(PONDER_SYNC.traces.value),
              gt(PONDER_SYNC.traces.value, 0n),
              filter.includeReverted
                ? undefined
                : isNull(PONDER_SYNC.traces.error),
              ...blockConditions,
            );

            const isFrom = fragment.toAddress === null;

            await appDb.insert(SUPER_ASSESSMENT.blocks).select(
              appDb
                .select({
                  name: sql
                    .raw(`'${source.name}:transfer:${isFrom ? "from" : "to"}'`)
                    .as("name"),
                  id: transferCheckpoint.as("id"),
                  chainId: PONDER_SYNC.traces.chainId,
                  number: PONDER_SYNC.blocks.number,
                  hash: PONDER_SYNC.blocks.hash,
                })
                .from(PONDER_SYNC.traces)
                .innerJoin(
                  PONDER_SYNC.blocks,
                  getJoinConditions(PONDER_SYNC.blocks, PONDER_SYNC.traces),
                )
                .where(condition),
            );

            await appDb.insert(SUPER_ASSESSMENT.transactions).select(
              appDb
                .select({
                  name: sql
                    .raw(`'${source.name}:transfer:${isFrom ? "from" : "to"}'`)
                    .as("name"),
                  id: transferCheckpoint.as("id"),
                  chainId: PONDER_SYNC.traces.chainId,
                  transactionIndex: PONDER_SYNC.transactions.transactionIndex,
                  hash: PONDER_SYNC.transactions.hash,
                })
                .from(PONDER_SYNC.traces)
                .innerJoin(
                  PONDER_SYNC.blocks,
                  getJoinConditions(PONDER_SYNC.blocks, PONDER_SYNC.traces),
                )
                .innerJoin(
                  PONDER_SYNC.transactions,
                  getJoinConditions(
                    PONDER_SYNC.transactions,
                    PONDER_SYNC.traces,
                  ),
                )
                .where(condition),
            );

            if (fragment.includeTransactionReceipts) {
              await appDb.insert(SUPER_ASSESSMENT.transactionReceipts).select(
                appDb
                  .select({
                    name: sql
                      .raw(
                        `'${source.name}:transfer:${isFrom ? "from" : "to"}'`,
                      )
                      .as("name"),
                    id: transferCheckpoint.as("id"),
                    chainId: PONDER_SYNC.traces.chainId,
                    transactionIndex:
                      PONDER_SYNC.transactionReceipts.transactionIndex,
                    hash: PONDER_SYNC.transactionReceipts.transactionHash,
                  })
                  .from(PONDER_SYNC.traces)
                  .innerJoin(
                    PONDER_SYNC.blocks,
                    getJoinConditions(PONDER_SYNC.blocks, PONDER_SYNC.traces),
                  )
                  .innerJoin(
                    PONDER_SYNC.transactionReceipts,
                    getJoinConditions(
                      PONDER_SYNC.transactionReceipts,
                      PONDER_SYNC.traces,
                    ),
                  )
                  .where(condition),
              );
            }

            await appDb.insert(SUPER_ASSESSMENT.traces).select(
              appDb
                .select({
                  name: sql
                    .raw(`'${source.name}:transfer:${isFrom ? "from" : "to"}'`)
                    .as("name"),
                  id: transferCheckpoint.as("id"),
                  chainId: PONDER_SYNC.traces.chainId,
                  traceIndex: PONDER_SYNC.traces.traceIndex,
                })
                .from(PONDER_SYNC.traces)
                .innerJoin(
                  PONDER_SYNC.blocks,
                  getJoinConditions(PONDER_SYNC.blocks, PONDER_SYNC.traces),
                )
                .where(condition),
            );

            break;
          }
        }
      }
    }
  }

  // remove uncached data

  if (SIM_PARAMS.MAX_UNCACHED_BLOCKS > 0) {
    for (const interval of await appDb.select().from(PONDER_SYNC.intervals)) {
      const intervals: [number, number][] = JSON.parse(
        `[${interval.blocks.slice(1, -1)}]`,
      );

      let resultIntervals: [number, number][] = [];
      for (const interval of intervals) {
        resultIntervals.push(
          ...getChunks({
            interval: [interval[0], interval[1] - 1],
            maxChunkSize: Math.floor(SIM_PARAMS.MAX_UNCACHED_BLOCKS / 2),
          }),
        );
      }

      const removedInterval1 = pick(
        resultIntervals,
        `removed_interval_1_${interval.fragmentId}`,
      );
      resultIntervals = resultIntervals.filter(
        (interval) => interval !== removedInterval1,
      );
      const removedInterval2 = pick(
        resultIntervals,
        `removed_interval_2_${interval.fragmentId}`,
      );
      resultIntervals = resultIntervals.filter(
        (interval) => interval !== removedInterval2,
      );

      resultIntervals = intervalUnion(resultIntervals);

      for (const blocks of resultIntervals) {
        const fragment = decodeFragment(interval.fragmentId);
        switch (fragment.type) {
          case "block": {
            blockConditions.push(
              and(
                eq(PONDER_SYNC.blocks.chainId, BigInt(fragment.chainId)),
                sql`(blocks.number - ${fragment.offset}) % ${fragment.interval} = 0`,
                gte(PONDER_SYNC.blocks.number, BigInt(blocks[0])),
                lte(PONDER_SYNC.blocks.number, BigInt(blocks[1])),
              )!,
            );

            break;
          }
          case "transaction": {
            const condition = and(
              eq(PONDER_SYNC.transactions.chainId, BigInt(fragment.chainId)),
              getAddressCondition(
                fragment.fromAddress,
                PONDER_SYNC.transactions,
                "from",
              ),
              getAddressCondition(
                fragment.toAddress,
                PONDER_SYNC.transactions,
                "to",
              ),
              gte(PONDER_SYNC.transactions.blockNumber, BigInt(blocks[0])),
              lte(PONDER_SYNC.transactions.blockNumber, BigInt(blocks[1])),
            )!;

            blockConditions.push(
              exists(
                appDb
                  .select()
                  .from(PONDER_SYNC.transactions)
                  .where(
                    and(
                      condition,
                      getJoinConditions(
                        PONDER_SYNC.transactions,
                        PONDER_SYNC.blocks,
                      ),
                    ),
                  ),
              ),
            );
            transactionConditions.push(condition);
            transactionReceiptConditions.push(
              exists(
                appDb
                  .select()
                  .from(PONDER_SYNC.transactions)
                  .where(
                    and(
                      condition,
                      getJoinConditions(
                        PONDER_SYNC.transactionReceipts,
                        PONDER_SYNC.transactions,
                      ),
                    ),
                  ),
              ),
            );

            break;
          }
          case "trace": {
            // Note: `includeReverted` and `callType` not supported
            const condition = and(
              eq(PONDER_SYNC.traces.chainId, BigInt(fragment.chainId)),
              getAddressCondition(
                fragment.fromAddress,
                PONDER_SYNC.traces,
                "from",
              ),
              getAddressCondition(fragment.toAddress, PONDER_SYNC.traces, "to"),
              fragment.functionSelector
                ? eq(
                    sql`substring(traces.input from 1 for 10)`,
                    fragment.functionSelector,
                  )
                : undefined,
              gte(PONDER_SYNC.traces.blockNumber, BigInt(blocks[0])),
              lte(PONDER_SYNC.traces.blockNumber, BigInt(blocks[1])),
            )!;

            blockConditions.push(
              exists(
                appDb
                  .select()
                  .from(PONDER_SYNC.traces)
                  .where(
                    and(
                      condition,
                      getJoinConditions(PONDER_SYNC.traces, PONDER_SYNC.blocks),
                    ),
                  ),
              ),
            );
            transactionConditions.push(
              exists(
                appDb
                  .select()
                  .from(PONDER_SYNC.traces)
                  .where(
                    and(
                      condition,
                      getJoinConditions(
                        PONDER_SYNC.traces,
                        PONDER_SYNC.transactions,
                      ),
                    ),
                  ),
              ),
            );
            if (fragment.includeTransactionReceipts) {
              transactionReceiptConditions.push(
                exists(
                  appDb
                    .select()
                    .from(PONDER_SYNC.traces)
                    .where(
                      and(
                        condition,
                        getJoinConditions(
                          PONDER_SYNC.traces,
                          PONDER_SYNC.transactionReceipts,
                        ),
                      ),
                    ),
                ),
              );
            }
            traceConditions.push(condition);

            break;
          }
          case "log": {
            const condition = and(
              eq(PONDER_SYNC.logs.chainId, BigInt(fragment.chainId)),
              getAddressCondition(
                fragment.address,
                PONDER_SYNC.logs,
                "address",
              ),
              fragment.topic0
                ? eq(PONDER_SYNC.logs.topic0, fragment.topic0)
                : undefined,
              fragment.topic1
                ? eq(PONDER_SYNC.logs.topic1, fragment.topic1)
                : undefined,
              fragment.topic2
                ? eq(PONDER_SYNC.logs.topic2, fragment.topic2)
                : undefined,
              fragment.topic3
                ? eq(PONDER_SYNC.logs.topic3, fragment.topic3)
                : undefined,
              gte(PONDER_SYNC.logs.blockNumber, BigInt(blocks[0])),
              lte(PONDER_SYNC.logs.blockNumber, BigInt(blocks[1])),
            )!;

            blockConditions.push(
              exists(
                appDb
                  .select()
                  .from(PONDER_SYNC.logs)
                  .where(
                    and(
                      condition,
                      getJoinConditions(PONDER_SYNC.logs, PONDER_SYNC.blocks),
                    ),
                  ),
              ),
            );
            transactionConditions.push(
              exists(
                appDb
                  .select()
                  .from(PONDER_SYNC.logs)
                  .where(
                    and(
                      condition,
                      getJoinConditions(
                        PONDER_SYNC.logs,
                        PONDER_SYNC.transactions,
                      ),
                    ),
                  ),
              ),
            );
            if (fragment.includeTransactionReceipts) {
              transactionReceiptConditions.push(
                exists(
                  appDb
                    .select()
                    .from(PONDER_SYNC.logs)
                    .where(
                      and(
                        condition,
                        getJoinConditions(
                          PONDER_SYNC.logs,
                          PONDER_SYNC.transactionReceipts,
                        ),
                      ),
                    ),
                ),
              );
            }
            logConditions.push(condition!);

            break;
          }
          case "transfer": {
            // Note: `includeReverted` not supported
            const condition = and(
              eq(PONDER_SYNC.traces.chainId, BigInt(fragment.chainId)),
              getAddressCondition(
                fragment.fromAddress,
                PONDER_SYNC.traces,
                "from",
              ),
              getAddressCondition(fragment.toAddress, PONDER_SYNC.traces, "to"),
              gte(PONDER_SYNC.traces.blockNumber, BigInt(blocks[0])),
              lte(PONDER_SYNC.traces.blockNumber, BigInt(blocks[1])),
            )!;

            blockConditions.push(
              exists(
                appDb
                  .select()
                  .from(PONDER_SYNC.traces)
                  .where(
                    and(
                      condition,
                      getJoinConditions(PONDER_SYNC.traces, PONDER_SYNC.blocks),
                    ),
                  ),
              ),
            );
            transactionConditions.push(
              exists(
                appDb
                  .select()
                  .from(PONDER_SYNC.traces)
                  .where(
                    and(
                      condition,
                      getJoinConditions(
                        PONDER_SYNC.traces,
                        PONDER_SYNC.transactions,
                      ),
                    ),
                  ),
              ),
            );
            if (fragment.includeTransactionReceipts) {
              transactionReceiptConditions.push(
                exists(
                  appDb
                    .select()
                    .from(PONDER_SYNC.traces)
                    .where(
                      and(
                        condition,
                        getJoinConditions(
                          PONDER_SYNC.traces,
                          PONDER_SYNC.transactionReceipts,
                        ),
                      ),
                    ),
                ),
              );
            }
            traceConditions.push(condition);

            break;
          }
        }
      }

      if (resultIntervals.length === 0) {
        await appDb
          .delete(PONDER_SYNC.intervals)
          .where(eq(PONDER_SYNC.intervals.fragmentId, interval.fragmentId));
      } else {
        const numranges = resultIntervals
          .map((interval) => {
            const start = interval[0];
            const end = interval[1] + 1;
            return `numrange(${start}, ${end}, '[]')`;
          })
          .join(", ");
        await appDb
          .update(PONDER_SYNC.intervals)
          .set({ blocks: sql.raw(`nummultirange(${numranges})`) })
          .where(eq(PONDER_SYNC.intervals.fragmentId, interval.fragmentId));
      }
    }

    if (blockConditions.length > 0) {
      await appDb
        .delete(PONDER_SYNC.blocks)
        .where(not(or(...blockConditions)!));
    } else {
      await appDb.delete(PONDER_SYNC.blocks);
    }

    if (transactionConditions.length > 0) {
      await appDb
        .delete(PONDER_SYNC.transactions)
        .where(not(or(...transactionConditions)!));
    } else {
      await appDb.delete(PONDER_SYNC.transactions);
    }

    if (transactionReceiptConditions.length > 0) {
      await appDb
        .delete(PONDER_SYNC.transactionReceipts)
        .where(not(or(...transactionReceiptConditions)!));
    } else {
      await appDb.delete(PONDER_SYNC.transactionReceipts);
    }

    if (traceConditions.length > 0) {
      await appDb
        .delete(PONDER_SYNC.traces)
        .where(not(or(...traceConditions)!));
    } else {
      await appDb.delete(PONDER_SYNC.traces);
    }

    if (logConditions.length > 0) {
      await appDb.delete(PONDER_SYNC.logs).where(not(or(...logConditions)!));
    } else {
      await appDb.delete(PONDER_SYNC.logs);
    }

    // TODO(kyle) delete factories
  }

  const chains: Parameters<typeof realtimeBlockEngine>[0] = new Map();
  for (let i = 0; i < app.indexingBuild.chains.length; i++) {
    const chain = app.indexingBuild.chains[i]!;
    const rpc = app.indexingBuild.rpcs[i]!;

    const intervals = intervalUnion(
      app.indexingBuild.sources
        .filter(({ filter }) => filter.chainId === chain.id)
        .map(({ filter }) => [filter.fromBlock, filter.toBlock]!),
    );

    const end = intervals[intervals.length - 1]![1];

    if (SIM_PARAMS.UNFINALIZED_BLOCKS !== 0) {
      app.indexingBuild.finalizedBlocks[i] = await _eth_getBlockByNumber(rpc, {
        blockNumber: end - SIM_PARAMS.UNFINALIZED_BLOCKS,
      });
    }

    // TODO(kyle) delete unfinalized data

    // if (SIM_PARAMS.FINALIZED_RATE === 0) {
    //   await appDb
    //     .delete(PONDER_SYNC.intervals)
    //     .where(eq(PONDER_SYNC.intervals.chainId, BigInt(chain.id)));
    // }

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
        app.common.options.rpcMaxConcurrency / app.indexingBuild.chains.length,
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

  let finishCount = 0;
  for (let i = 0; i < app.indexingBuild.chains.length; i++) {
    const chain = app.indexingBuild.chains[i]!;
    const rpc = app.indexingBuild.rpcs[i]!;

    rpc.subscribe = ({ onBlock }) => {
      (async () => {
        let block: RpcBlock | RpcBlockHeader;
        let isAccepted: boolean;

        for await (block of getRealtimeBlockGenerator(chain.id)) {
          isAccepted = await onBlock(block).then(async (result) => {
            if (result.type === "accepted") {
              await result.blockPromise;
              return true;
            }

            if (result.type === "reorg") {
              await result.reorgPromise;
              return false;
            }

            return false;
          });
        }
        // Note: last block must be accepted before shutdown
        while (isAccepted! === false) {
          isAccepted = await onBlock(block!).then(async (result) => {
            if (result.type === "accepted") {
              await result.blockPromise;
              return true;
            }

            if (result.type === "reorg") {
              await result.reorgPromise;
              return false;
            }

            return false;
          });
        }

        app.common.logger.warn({
          service: "sim",
          msg: `Realtime block subscription for chain '${chain.name}' completed`,
        });
        finishCount += 1;
        if (finishCount === app.indexingBuild.chains.length) {
          pwr.resolve();
        }
      })();
    };

    app.common.logger.warn({
      service: "sim",
      msg: `Mocking realtime block subscription for chain '${chain.name}'`,
    });
  }

  return app;
};

let kill = await start({
  cliOptions: {
    ...program.optsWithGlobals(),
    command: "start",
    version: packageJson.version,
    root: APP_DIR,
    config: "ponder.config.ts",
  },
  onBuild,
});

export const restart = async () => {
  await kill!();
  kill = await start({
    cliOptions: {
      ...program.optsWithGlobals(),
      command: "start",
      version: packageJson.version,
      root: APP_DIR,
      config: "ponder.config.ts",
    },
    onBuild,
  });
};

// if (SIM_PARAMS.SHUTDOWN_TIMER) {
//   await SIM_PARAMS.SHUTDOWN_TIMER();
//   await restart();
// }

if (SIM_PARAMS.UNFINALIZED_BLOCKS === 0) {
  while (true) {
    try {
      const result = await fetch("http://localhost:42069/ready");
      if (result.status === 200) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
} else {
  await pwr.promise;
}

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

const schema = await import(`../apps/${APP_ID}/ponder.schema.ts`);
for (const key of Object.keys(schema)) {
  if (APP_ID === "super-assessment" && key === "checkpoints") continue;

  if (is(schema[key], Table)) {
    const table = schema[key] as Table;
    const tableName = getTableName(table);

    await compareTables(
      appDb,
      table,
      `expected."${tableName}"`,
      `"${tableName}"`,
    );
  }
}

// await compareTables(
//   appDb,
//   INTERVALS,
//   "ponder_sync.expected_intervals",
//   "ponder_sync.intervals",
// );

await db.update(metadata).set({ success: true }).where(eq(metadata.id, UUID));

process.exit(0);
