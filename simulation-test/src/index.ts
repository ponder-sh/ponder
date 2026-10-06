import childProcess from "node:child_process";
import crypto from "node:crypto";
import { type PonderApp, start } from "@ponder/bin/commands/start.js";
import { createQB } from "@ponder/database/queryBuilder.js";
import { getPrimaryKeyColumns } from "@ponder/drizzle/index.js";
import type {
  EventCallback,
  Factory,
  FragmentAddress,
  LightBlock,
} from "@ponder/internal/types.js";
import { eth_getBlockByNumber } from "@ponder/rpc/actions.js";
import { createRpc } from "@ponder/rpc/index.js";
import { getFilterFactories } from "@ponder/runtime/filter.js";
import {
  decodeFragment,
  getFragments,
  isFragmentAddressFactory,
} from "@ponder/runtime/fragments.js";
import * as PONDER_SYNC from "@ponder/sync-store/schema.js";
import { decodeCheckpoint } from "@ponder/utils/checkpoint";
import { getChunks, intervalUnion } from "@ponder/utils/interval.js";
import { promiseWithResolvers } from "@ponder/utils/promiseWithResolvers.js";
import { Command } from "commander";
import {
  and,
  eq,
  exists,
  getTableName,
  gt,
  gte,
  is,
  isNotNull,
  lte,
  not,
  notInArray,
  or,
  type SQL,
  sql,
  Table,
} from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import seedrandom from "seedrandom";
import {
  type Address,
  custom,
  hexToNumber,
  numberToHex,
  type RpcBlock,
} from "viem";
import packageJson from "../../packages/core/package.json";

import * as SUPER_ASSESSMENT from "../apps/super-assessment/schema.js";
import { metadata } from "../schema.js";
import { dbSim } from "./db-sim.js";
import {
  copyTemplateFactoryData,
  getExpectedChildAddresses,
  getMissingExpectedParents,
} from "./factory.js";
import { type RpcBlockHeader, realtimeBlockEngine, sim } from "./rpc-sim.js";
import { getJoinConditions } from "./sql.js";

// Large apps that shouldn't be synced, use cached data instead
const CACHED_APPS = ["the-compact", "basepaint"];
// Apps with small block ranges. In-memory sync fetches all data through the simulated rpc on every start.
const IN_MEMORY_SYNC_APPS = [
  "assessment",
  "feature-multichain",
  "reference-erc20",
  "super-assessment",
  "uniswap-v4",
];

// inputs

/** Maximum time in milliseconds for the app to shut down. */
const SHUTDOWN_TIMEOUT = 30_000;

const DATABASE_URL = process.env.DATABASE_URL!;
const APP_ID = process.argv[2];
const APP_DIR = `./apps/${APP_ID}`;
export const SEED = process.env.SEED ?? crypto.randomBytes(32).toString("hex");
export const UUID = process.env.UUID ?? crypto.randomUUID();
const ORACLE_DATABASE = `${UUID}_oracle`;
export const PORT = process.env.PORT ?? 42069;

if (APP_ID === undefined) {
  throw new Error("App ID is required. Example: 'pnpm test [app id]'");
}

// app state

export let APP: PonderApp | undefined;
export let IS_REALTIME = false;
export let RESTART_COUNT = 0;
/** True while the app runs the previous config, before the tested config. */
export let IS_PREVIOUS_RUN = false;

/**
 * Block that the simulated "latest" block is derived from, for each chain. It is after the
 * mocked finalized block when the finalized block advances during the backfill.
 */
export const FINALIZED_TARGETS = new Map<number, LightBlock>();
/** Finalized block number of the app, for each chain. */
export const APP_FINALIZED = new Map<number, number>();

// sim params

export const pick = <T>(possibilities: T[] | readonly T[], tag: string): T => {
  return possibilities[
    Math.floor(possibilities.length * seedrandom(SEED + tag)())
  ]!;
};

export const SIM_PARAMS = {
  RPC_ERROR_RATE: pick([0, 0.02, 0.05], "rpc-error-rate"),
  DB_ERROR_RATE: pick([0, 0.001, 0.001], "db-error-rate"),
  DB_ERROR_RATE_TRANSACTION: pick(
    [0, 0.00005, 0.00005],
    "db-error-rate-transaction",
  ),
  MAX_UNCACHED_BLOCKS: CACHED_APPS.includes(APP_ID)
    ? 0
    : pick([0, 0, 0, 100, 250], "max-uncached-blocks"),
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
  REALTIME_REORG_RATE: pick([0, 0.02, 0.05], "realtime-reorg-rate"),
  REALTIME_DEEP_REORG_RATE: pick([0, 0.01, 0.02], "realtime-deep-reorg-rate"),
  REALTIME_FAST_FORWARD_RATE: pick(
    [0, 0.25, 0.5, 0.75],
    "realtime-fast-forward-rate",
  ),
  REALTIME_DELAY_RATE: pick([0, 0.4, 0.8], "realtime-delay-rate"),
  UNFINALIZED_BLOCKS: pick([0, 0, 50, 100, 250, 300], "unfinalized-blocks"),
  REALTIME_SHUTDOWN_RATE: pick([0, 0.001, 0.002], "realtime-shutdown-rate"),
  ORDERING:
    // Note: The super-assessment schema does not support "experimental_isolated".
    APP_ID === "assessment"
      ? pick(["multichain", "omnichain", "experimental_isolated"], "ordering")
      : pick(["multichain", "omnichain"], "ordering"),
  REALTIME_BLOCK_HAS_TRANSACTIONS: pick(
    [true, false],
    "realtime-block-has-transactions",
  ),
  SYNC_EVENTS_QUERY_SIZE: pick([50, 200, 2_000], "sync-events-query-size"),
  FACTORY_ADDRESS_COUNT_THRESHOLD: pick(
    [1_000, 20, 1],
    "factory-address-count-threshold",
  ),
  INDEXING_CACHE_MAX_BYTES: pick(
    [undefined, 64 * 1024],
    "indexing-cache-max-bytes",
  ),
  FINALIZED_ADVANCE_BLOCKS: pick([0, 0, 10, 30], "finalized-advance-blocks"),
  HISTORICAL_SHUTDOWN_PROGRESS: pick(
    [undefined, undefined, 0.25, 0.5, 0.75],
    "historical-shutdown-progress",
  ),
  // Note: Run a different config on the same sync store before the tested config.
  PREVIOUS_RUN:
    APP_ID === "super-assessment"
      ? pick([false, false, true], "previous-run")
      : false,
  SYNC_STORE: undefined as "template" | "empty" | undefined,
  CACHE_RPC_REQUESTS: IN_MEMORY_SYNC_APPS.includes(APP_ID)
    ? pick([true, false], "cache-rpc-requests")
    : true,
};

// Note: The previous run must start with an empty sync store, so that the tested config
// only reuses data that the previous run synced.
SIM_PARAMS.SYNC_STORE =
  APP_ID !== "super-assessment"
    ? "template"
    : SIM_PARAMS.PREVIOUS_RUN
      ? "empty"
      : pick(["template", "template", "empty"], "sync-store");

// 1. Setup database

export const DB = drizzle(DATABASE_URL!, { casing: "snake_case" });
export const APP_DB = drizzle(`${DATABASE_URL!}/${UUID}`, {
  casing: "snake_case",
});

await DB.execute(sql.raw(`CREATE DATABASE "${UUID}" TEMPLATE "${APP_ID}"`));

// Note: `migrateSync()` does not copy all data from an earlier sync schema (e.g. factory
// intervals). A template without the latest sync schema causes a large uncached sync.
const templateSyncSchema = await APP_DB.execute(
  sql`SELECT 1 FROM information_schema.schemata WHERE schema_name = ${PONDER_SYNC.PONDER_SYNC_SCHEMA}`,
);
if (templateSyncSchema.rows.length === 0) {
  console.error(
    `INFRA ERROR: Template database "${APP_ID}" does not have the "${PONDER_SYNC.PONDER_SYNC_SCHEMA}" schema. Migrate and sync the template before running simulations.`,
  );
  await DB.execute(sql.raw(`DROP DATABASE IF EXISTS "${UUID}" WITH (FORCE)`));
  process.exit(2);
}

// Note: An empty sync store makes the app fetch all data through the simulated rpc, and
// the app reuses only data that it synced itself.
if (SIM_PARAMS.SYNC_STORE === "empty") {
  const { rows } = await APP_DB.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = ${PONDER_SYNC.PONDER_SYNC_SCHEMA}`,
  );
  await APP_DB.execute(
    sql.raw(
      `TRUNCATE ${rows.map(({ tablename }) => `"${PONDER_SYNC.PONDER_SYNC_SCHEMA}"."${tablename}"`).join(", ")} RESTART IDENTITY`,
    ),
  );
}

/** Returns an SQL condition that filters by address. */
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

    // Note: Each fragment of a factory has one parent. A child of more than one parent
    // is not supported, because the expected tables would have duplicate rows.
    return sql`EXISTS (SELECT 1 FROM (${getExpectedChildAddresses(filterAddress as Factory, (fragmentAddress as { address: Address }).address)}) AS children
      WHERE children.address = ${addressColumn} AND children.block_number <= ${table.blockNumber})`;
  } else if (typeof fragmentAddress === "string") {
    return eq(addressColumn, fragmentAddress);
  } else {
    return sql`true`;
  }
};

// 2. Write metadata

const branchResult = childProcess.execSync("git rev-parse --abbrev-ref HEAD");
const commitResult = childProcess.execSync("git rev-parse HEAD");

const branch = branchResult.toString().trim();
const commit = commitResult.toString().trim();

await DB.insert(metadata).values({
  id: UUID,
  seed: SEED,
  app: APP_ID,
  commit: commit.trim(),
  branch: branch.trim(),
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
process.env.ORDERING = SIM_PARAMS.ORDERING;

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
  APP = app;
  FINALIZED_TARGETS.clear();
  APP_FINALIZED.clear();

  app.common.options.syncEventsQuerySize = SIM_PARAMS.SYNC_EVENTS_QUERY_SIZE;
  app.common.options.factoryAddressCountThreshold =
    SIM_PARAMS.FACTORY_ADDRESS_COUNT_THRESHOLD;
  if (SIM_PARAMS.INDEXING_CACHE_MAX_BYTES !== undefined) {
    app.common.options.indexingCacheMaxBytes =
      SIM_PARAMS.INDEXING_CACHE_MAX_BYTES;
  }
  // Note: this forces the app to run in a single thread.
  app.common.options.maxThreads = 1;

  // Mock database

  app.common.logger.warn({
    msg: "Mocking syncQB, adminQB, userQB, and readonlyQB",
  });

  app.database.syncQB = createQB(
    dbSim(
      drizzle(app.database.driver.sync!, {
        casing: "snake_case",
        schema: PONDER_SYNC,
      }),
    ),
    { common: app.common, isAdmin: false },
  );

  app.database.adminQB = createQB(
    dbSim(drizzle(app.database.driver.admin!, { casing: "snake_case" })),
    { common: app.common, isAdmin: true },
  );

  app.database.userQB = createQB(
    dbSim(drizzle(app.database.driver.user!, { casing: "snake_case" })),
    { common: app.common, isAdmin: false },
  );

  app.database.readonlyQB = createQB(
    dbSim(drizzle(app.database.driver.readonly!, { casing: "snake_case" })),
    { common: app.common, isAdmin: false },
  );

  if (APP_ID === "super-assessment" && IS_PREVIOUS_RUN === false) {
    const random = seedrandom(`${SEED}_super_assessment_filter`);
    for (let i = 0; i < app.indexingBuild.eventCallbacks.length; i++) {
      app.indexingBuild.eventCallbacks[i] = app.indexingBuild.eventCallbacks[
        i
      ]!.filter(() => {
        if (random() < SIM_PARAMS.SUPER_ASSESSMENT_FILTER_RATE) {
          return false;
        }
        return true;
      });
    }

    if (app.indexingBuild.eventCallbacks.flat().length === 0) {
      console.error("Invalid app configuration: no event callbacks");
      process.exit(0);
    }

    const chainsWithSources: typeof app.indexingBuild.chains = [];
    const rpcsWithSources: typeof app.indexingBuild.rpcs = [];
    const finalizedBlocksWithSources: typeof app.indexingBuild.finalizedBlocks =
      [];
    const eventCallbacksWithSources: EventCallback[][] = [];
    for (let i = 0; i < app.indexingBuild.chains.length; i++) {
      const chain = app.indexingBuild.chains[i]!;
      const rpc = app.indexingBuild.rpcs[i]!;
      const finalizedBlock = app.indexingBuild.finalizedBlocks[i]!;
      const eventCallbacks = app.indexingBuild.eventCallbacks[i]!;
      if (eventCallbacks.length > 0) {
        chainsWithSources.push(chain);
        rpcsWithSources.push(rpc);
        finalizedBlocksWithSources.push(finalizedBlock);
        eventCallbacksWithSources.push(eventCallbacks);
      }
    }

    app.indexingBuild.chains = chainsWithSources;
    app.indexingBuild.rpcs = rpcsWithSources;
    app.indexingBuild.finalizedBlocks = finalizedBlocksWithSources;
    app.indexingBuild.eventCallbacks = eventCallbacksWithSources;
  }

  // Note: The expected tables are built once. A restart uses the same tables.
  if (
    APP_ID === "super-assessment" &&
    RESTART_COUNT === 0 &&
    IS_PREVIOUS_RUN === false
  ) {
    // build super assessment expected tables

    // Note: The expected tables are built in a separate copy of the template, so that
    // changes to the sync store of the app (for example an empty sync store) do not
    // change the expected tables.
    await DB.execute(
      sql.raw(`CREATE DATABASE "${ORACLE_DATABASE}" TEMPLATE "${APP_ID}"`),
    );
    const ORACLE_DB = drizzle(`${DATABASE_URL!}/${ORACLE_DATABASE}`, {
      casing: "snake_case",
    });
    let infraError: string | undefined;

    const buildExpectedTables = async () => {
      await copyTemplateFactoryData(ORACLE_DB);

      await migrate(ORACLE_DB, {
        migrationsFolder: "./apps/super-assessment/migrations",
      });

      const factories = new Map<Factory["id"], Factory>();
      for (const { filter } of app.indexingBuild.eventCallbacks.flat()) {
        for (const factory of getFilterFactories(filter)) {
          factories.set(factory.id, factory);
        }
      }
      for (const factory of factories.values()) {
        const missingParents = await getMissingExpectedParents(
          ORACLE_DB,
          factory,
        );
        if (missingParents.length > 0) {
          infraError = `INFRA ERROR: Template database "${APP_ID}" does not have the child addresses of factory parents ${missingParents.join(", ")} on chain ${factory.chainId} for blocks [${factory.fromBlock}, ${factory.toBlock}]. Add the factory to the config without SEED and sync the template.`;
          return;
        }

        const children = await ORACLE_DB.execute(
          sql`SELECT count(*) AS count FROM (${getExpectedChildAddresses(factory)}) AS children`,
        );
        console.log(
          `Expected child addresses: ${children.rows[0]!.count} (factory ${factory.id})`,
        );
      }

      // Trace index of each trace that matches at least one trace or transfer filter

      await ORACLE_DB.execute(
        sql`CREATE TABLE IF NOT EXISTS expected_trace_indexes (
        chain_id bigint NOT NULL,
        block_number bigint NOT NULL,
        transaction_index integer NOT NULL,
        trace_address integer[] NOT NULL,
        trace_index bigint NOT NULL
      )`,
      );
      await ORACLE_DB.execute(sql`TRUNCATE expected_trace_indexes`);

      const matchedTraceConditions: SQL[] = [];
      for (const { filter } of app.indexingBuild.eventCallbacks.flat()) {
        if (filter.type !== "trace" && filter.type !== "transfer") continue;

        for (const { fragment } of getFragments(filter)) {
          if (fragment.type !== "trace" && fragment.type !== "transfer")
            continue;

          matchedTraceConditions.push(
            and(
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
              filter.type === "trace" && filter.callType
                ? eq(PONDER_SYNC.traces.type, filter.callType)
                : undefined,
              fragment.type === "trace" && fragment.functionSelector
                ? eq(
                    sql`substring(traces.input from 1 for 10)`,
                    fragment.functionSelector,
                  )
                : undefined,
              filter.type === "transfer"
                ? and(
                    isNotNull(PONDER_SYNC.traces.value),
                    gt(PONDER_SYNC.traces.value, 0n),
                    notInArray(PONDER_SYNC.traces.type, [
                      "DELEGATECALL",
                      "CALLCODE",
                    ]),
                  )
                : undefined,
              filter.fromBlock
                ? gte(PONDER_SYNC.blocks.number, BigInt(filter.fromBlock))
                : undefined,
              filter.toBlock
                ? lte(PONDER_SYNC.blocks.number, BigInt(filter.toBlock))
                : undefined,
            )!,
          );
        }
      }

      if (matchedTraceConditions.length > 0) {
        const matchedTraces = ORACLE_DB.selectDistinct({
          chainId: PONDER_SYNC.traces.chainId,
          blockNumber: PONDER_SYNC.traces.blockNumber,
          transactionIndex: PONDER_SYNC.traces.transactionIndex,
          traceAddress: PONDER_SYNC.traces.traceAddress,
        })
          .from(PONDER_SYNC.traces)
          .innerJoin(
            PONDER_SYNC.blocks,
            getJoinConditions(PONDER_SYNC.blocks, PONDER_SYNC.traces),
          )
          .where(or(...matchedTraceConditions));

        await ORACLE_DB.execute(
          sql`INSERT INTO expected_trace_indexes
          SELECT chain_id, block_number, transaction_index, trace_address,
            row_number() OVER (
              PARTITION BY chain_id, block_number, transaction_index
              ORDER BY trace_address
            ) - 1
          FROM (${matchedTraces}) AS matched_traces`,
        );
      }

      for (const eventCallback of app.indexingBuild.eventCallbacks.flat()) {
        const filter = eventCallback.filter;
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

              await ORACLE_DB.insert(SUPER_ASSESSMENT.blocks).select(
                ORACLE_DB.select({
                  name: sql.raw(`'${eventCallback.name}'`).as("name"),
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

              await ORACLE_DB.insert(SUPER_ASSESSMENT.blocks).select(
                ORACLE_DB.select({
                  name: sql.raw(`'${eventCallback.name}'`).as("name"),
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

              await ORACLE_DB.insert(SUPER_ASSESSMENT.transactions).select(
                ORACLE_DB.select({
                  name: sql.raw(`'${eventCallback.name}'`).as("name"),
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

              await ORACLE_DB.insert(
                SUPER_ASSESSMENT.transactionReceipts,
              ).select(
                ORACLE_DB.select({
                  name: sql.raw(`'${eventCallback.name}'`).as("name"),
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
            lpad((SELECT expected.trace_index FROM expected_trace_indexes AS expected
              WHERE expected.chain_id = traces.chain_id
                AND expected.block_number = traces.block_number
                AND expected.transaction_index = traces.transaction_index
                AND expected.trace_address = traces.trace_address
            )::text, 16, '0'))`,
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

              await ORACLE_DB.insert(SUPER_ASSESSMENT.blocks).select(
                ORACLE_DB.select({
                  name: sql.raw(`'${eventCallback.name}'`).as("name"),
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

              await ORACLE_DB.insert(SUPER_ASSESSMENT.transactions).select(
                ORACLE_DB.select({
                  name: sql.raw(`'${eventCallback.name}'`).as("name"),
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
                await ORACLE_DB.insert(
                  SUPER_ASSESSMENT.transactionReceipts,
                ).select(
                  ORACLE_DB.select({
                    name: sql.raw(`'${eventCallback.name}'`).as("name"),
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

              await ORACLE_DB.insert(SUPER_ASSESSMENT.traces).select(
                ORACLE_DB.select({
                  name: sql.raw(`'${eventCallback.name}'`).as("name"),
                  id: traceCheckpoint.as("id"),
                  chainId: PONDER_SYNC.traces.chainId,
                  traceAddress: PONDER_SYNC.traces.traceAddress,
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

              await ORACLE_DB.insert(SUPER_ASSESSMENT.blocks).select(
                ORACLE_DB.select({
                  name: sql.raw(`'${eventCallback.name}'`).as("name"),
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

              await ORACLE_DB.insert(SUPER_ASSESSMENT.transactions).select(
                ORACLE_DB.select({
                  name: sql.raw(`'${eventCallback.name}'`).as("name"),
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
                    getJoinConditions(
                      PONDER_SYNC.transactions,
                      PONDER_SYNC.logs,
                    ),
                  )
                  .where(condition),
              );

              if (fragment.includeTransactionReceipts) {
                await ORACLE_DB.insert(
                  SUPER_ASSESSMENT.transactionReceipts,
                ).select(
                  ORACLE_DB.select({
                    name: sql.raw(`'${eventCallback.name}'`).as("name"),
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

              await ORACLE_DB.insert(SUPER_ASSESSMENT.logs).select(
                ORACLE_DB.select({
                  name: sql.raw(`'${eventCallback.name}'`).as("name"),
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
            lpad((SELECT expected.trace_index FROM expected_trace_indexes AS expected
              WHERE expected.chain_id = traces.chain_id
                AND expected.block_number = traces.block_number
                AND expected.transaction_index = traces.transaction_index
                AND expected.trace_address = traces.trace_address
            )::text, 16, '0'))`,
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
                notInArray(PONDER_SYNC.traces.type, [
                  "DELEGATECALL",
                  "CALLCODE",
                ]),
                ...blockConditions,
              );

              await ORACLE_DB.insert(SUPER_ASSESSMENT.blocks).select(
                ORACLE_DB.select({
                  name: sql.raw(`'${eventCallback.name}'`).as("name"),
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

              await ORACLE_DB.insert(SUPER_ASSESSMENT.transactions).select(
                ORACLE_DB.select({
                  name: sql.raw(`'${eventCallback.name}'`).as("name"),
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
                await ORACLE_DB.insert(
                  SUPER_ASSESSMENT.transactionReceipts,
                ).select(
                  ORACLE_DB.select({
                    name: sql.raw(`'${eventCallback.name}'`).as("name"),
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

              await ORACLE_DB.insert(SUPER_ASSESSMENT.traces).select(
                ORACLE_DB.select({
                  name: sql.raw(`'${eventCallback.name}'`).as("name"),
                  id: transferCheckpoint.as("id"),
                  chainId: PONDER_SYNC.traces.chainId,
                  traceAddress: PONDER_SYNC.traces.traceAddress,
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

      const expectedRows = await ORACLE_DB.execute(
        sql`SELECT name, count(*) AS count FROM expected.blocks GROUP BY name ORDER BY name`,
      );
      console.log("Expected rows:");
      console.table(expectedRows.rows);

      // Copy the expected tables to the database of the app.

      await migrate(APP_DB, {
        migrationsFolder: "./apps/super-assessment/migrations",
      });
      for (const table of [
        SUPER_ASSESSMENT.blocks,
        SUPER_ASSESSMENT.transactions,
        SUPER_ASSESSMENT.transactionReceipts,
        SUPER_ASSESSMENT.traces,
        SUPER_ASSESSMENT.logs,
      ]) {
        const rows = await ORACLE_DB.select().from(table);
        for (let i = 0; i < rows.length; i += 1_000) {
          await APP_DB.insert(table).values(rows.slice(i, i + 1_000));
        }
      }
    };

    try {
      await buildExpectedTables();
    } finally {
      await (ORACLE_DB.$client as { end: () => Promise<void> }).end();
      await DB.execute(
        sql.raw(`DROP DATABASE IF EXISTS "${ORACLE_DATABASE}" WITH (FORCE)`),
      );
    }

    if (infraError) {
      console.error(infraError);
      process.exit(2);
    }
  }

  // Simulate a crash during the backfill.
  //
  // Note: The restart is triggered by indexing progress, not by time, so that the same seed
  // restarts at the same point.

  if (
    SIM_PARAMS.HISTORICAL_SHUTDOWN_PROGRESS !== undefined &&
    RESTART_COUNT === 0 &&
    IS_PREVIOUS_RUN === false
  ) {
    let isTriggered = false;
    for (const eventCallbacks of app.indexingBuild.eventCallbacks) {
      if (eventCallbacks.length === 0) continue;

      const fromBlock = Math.min(
        ...eventCallbacks.map(({ filter }) => filter.fromBlock ?? 0),
      );
      const toBlock = Math.max(
        ...eventCallbacks.map(({ filter }) => filter.toBlock!),
      );
      const targetBlock =
        fromBlock +
        Math.floor(
          (toBlock - fromBlock) * SIM_PARAMS.HISTORICAL_SHUTDOWN_PROGRESS,
        );

      for (const eventCallback of eventCallbacks) {
        const fn = eventCallback.fn;
        eventCallback.fn = async (...args: any[]) => {
          if (
            isTriggered === false &&
            IS_REALTIME === false &&
            Number(args[0].event.block.number) >= targetBlock
          ) {
            isTriggered = true;
            console.log(
              `Restarting app during the backfill at block ${args[0].event.block.number} on chain ${eventCallback.chain.id}`,
            );
            setTimeout(restart, 0);
          }
          return fn(...args);
        };
      }
    }
  }

  // Remove uncached data

  // SQL conditions for data that should not be deleted.
  const blockConditions: SQL[] = [];
  const transactionConditions: SQL[] = [];
  const transactionReceiptConditions: SQL[] = [];
  const traceConditions: SQL[] = [];
  const logConditions: SQL[] = [];

  if (SIM_PARAMS.MAX_UNCACHED_BLOCKS > 0 && IS_PREVIOUS_RUN === false) {
    for (const interval of await APP_DB.select().from(PONDER_SYNC.intervals)) {
      if (interval.fragmentId.startsWith("factory_")) continue;
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

      // TODO(kyle) Determine which factory intervals should be removed.

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
                APP_DB.select()
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
                APP_DB.select()
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
            // Note: `callType` not supported
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
                APP_DB.select()
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
                APP_DB.select()
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
                  APP_DB.select()
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
                APP_DB.select()
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
                APP_DB.select()
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
                  APP_DB.select()
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
                APP_DB.select()
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
                APP_DB.select()
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
                  APP_DB.select()
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
        await APP_DB.delete(PONDER_SYNC.intervals).where(
          eq(PONDER_SYNC.intervals.fragmentId, interval.fragmentId),
        );
      } else {
        const numranges = resultIntervals
          .map((interval) => {
            const start = interval[0];
            const end = interval[1] + 1;
            return `numrange(${start}, ${end}, '[]')`;
          })
          .join(", ");
        await APP_DB.update(PONDER_SYNC.intervals)
          .set({ blocks: sql.raw(`nummultirange(${numranges})`) })
          .where(eq(PONDER_SYNC.intervals.fragmentId, interval.fragmentId));
      }
    }

    if (blockConditions.length > 0) {
      await APP_DB.delete(PONDER_SYNC.blocks).where(
        not(or(...blockConditions)!),
      );
    } else {
      await APP_DB.delete(PONDER_SYNC.blocks);
    }

    if (transactionConditions.length > 0) {
      await APP_DB.delete(PONDER_SYNC.transactions).where(
        not(or(...transactionConditions)!),
      );
    } else {
      await APP_DB.delete(PONDER_SYNC.transactions);
    }

    if (transactionReceiptConditions.length > 0) {
      await APP_DB.delete(PONDER_SYNC.transactionReceipts).where(
        not(or(...transactionReceiptConditions)!),
      );
    } else {
      await APP_DB.delete(PONDER_SYNC.transactionReceipts);
    }

    if (traceConditions.length > 0) {
      await APP_DB.delete(PONDER_SYNC.traces).where(
        not(or(...traceConditions)!),
      );
    } else {
      await APP_DB.delete(PONDER_SYNC.traces);
    }

    if (logConditions.length > 0) {
      await APP_DB.delete(PONDER_SYNC.logs).where(not(or(...logConditions)!));
    } else {
      await APP_DB.delete(PONDER_SYNC.logs);
    }

    // TODO(kyle) delete factories
  }

  // Mock RPC

  const chains: Parameters<typeof realtimeBlockEngine>[0] = new Map();
  for (let i = 0; i < app.indexingBuild.chains.length; i++) {
    const chain = app.indexingBuild.chains[i]!;
    const rpc = app.indexingBuild.rpcs[i]!;

    const intervals = intervalUnion(
      app.indexingBuild.eventCallbacks[i]!.map(({ filter }) => [
        filter.fromBlock!,
        filter.toBlock!,
      ]),
    );

    const end = intervals[intervals.length - 1]![1];

    // Mock finalized block

    if (SIM_PARAMS.UNFINALIZED_BLOCKS !== 0 && IS_PREVIOUS_RUN === false) {
      if (RESTART_COUNT === 0) {
        app.indexingBuild.finalizedBlocks[i] = await eth_getBlockByNumber(rpc, [
          numberToHex(end - SIM_PARAMS.UNFINALIZED_BLOCKS),
          false,
        ]);
      } else {
        // Note: Use the latest indexed block as the finalized block. This ensures that
        // the finalized block >= crash recovery checkpoint.

        // Note: The app can restart before it writes a checkpoint.
        const { rows } = await APP_DB.execute(
          `SELECT latest_checkpoint FROM _ponder_checkpoint WHERE chain_name = '${chain.name}'`,
        ).catch(() => ({ rows: [] }));
        const latestCheckpointBlock =
          rows.length === 0
            ? 0
            : Number(
                decodeCheckpoint(rows[0]!.latest_checkpoint as string)
                  .blockNumber,
              );

        app.indexingBuild.finalizedBlocks[i] = await eth_getBlockByNumber(rpc, [
          numberToHex(
            Math.min(
              Math.max(
                latestCheckpointBlock,
                end - SIM_PARAMS.UNFINALIZED_BLOCKS,
              ),
              end - 10,
            ),
          ),
          false,
        ]);
      }

      const finalizedBlock = app.indexingBuild.finalizedBlocks[i]!;
      APP_FINALIZED.set(chain.id, hexToNumber(finalizedBlock.number));

      // Note: The template has child addresses after the mocked finalized block. An app
      // only has child addresses up to its finalized block, and finds later ones during
      // live indexing.
      if (RESTART_COUNT === 0) {
        await APP_DB.execute(
          sql`DELETE FROM ${PONDER_SYNC.factoryAddresses} WHERE chain_id = ${chain.id} AND block_number > ${hexToNumber(finalizedBlock.number)}`,
        );
        await APP_DB.execute(
          sql`UPDATE ${PONDER_SYNC.intervals}
            SET blocks = blocks * nummultirange(numrange(0, ${hexToNumber(finalizedBlock.number) + 1}, '[]'))
            WHERE chain_id = ${chain.id} AND starts_with(fragment_id, 'factory_log_')`,
        );
        await APP_DB.execute(
          sql`DELETE FROM ${PONDER_SYNC.intervals} WHERE chain_id = ${chain.id} AND isempty(blocks)`,
        );
      }

      // Note: Advance the finalized block once during the backfill. The app refetches the
      // finalized block after the first pass and syncs the new range in a catch-up pass.
      const advancedBlockNumber = Math.min(
        hexToNumber(finalizedBlock.number) +
          SIM_PARAMS.FINALIZED_ADVANCE_BLOCKS,
        end - 20,
      );
      if (advancedBlockNumber > hexToNumber(finalizedBlock.number)) {
        FINALIZED_TARGETS.set(
          chain.id,
          await eth_getBlockByNumber(rpc, [
            numberToHex(advancedBlockNumber),
            false,
          ]),
        );
        app.common.options.backfillFinalizedRefetchInterval = 0;
      } else {
        FINALIZED_TARGETS.set(chain.id, finalizedBlock);
      }
    }

    // TODO(kyle) delete unfinalized data

    // if (SIM_PARAMS.FINALIZED_RATE === 0) {
    //   await APP_DB
    //     .delete(PONDER_SYNC.intervals)
    //     .where(eq(PONDER_SYNC.intervals.chainId, BigInt(chain.id)));
    // }

    // Note: The previous run must write to the sync store.
    chain.cacheRpcRequests = IS_PREVIOUS_RUN
      ? true
      : SIM_PARAMS.CACHE_RPC_REQUESTS;

    // replace rpc with simulated transport

    chain.rpc = sim(
      custom({
        async request(body) {
          return rpc.request(body);
        },
      }),
    );

    app.indexingBuild.rpcs[i] = createRpc({
      common: app.common,
      chain,
      concurrency: Math.floor(
        app.common.options.rpcMaxConcurrency / app.indexingBuild.chains.length,
      ),
    });

    chains.set(chain.id, {
      // @ts-expect-error
      request: rpc.request,
      interval: [
        hexToNumber(app.indexingBuild.finalizedBlocks[i]!.number) + 1,
        end,
      ],
    });

    app.common.logger.warn({
      msg: `Mocking eip1193 transport for chain '${chain.name}'`,
    });
  }

  const getRealtimeBlockGenerator = await realtimeBlockEngine(chains);

  let finishCount = 0;
  for (let i = 0; i < app.indexingBuild.chains.length; i++) {
    const chain = app.indexingBuild.chains[i]!;
    const rpc = app.indexingBuild.rpcs[i]!;

    rpc.subscribe = ({ onBlock }) => {
      (async () => {
        IS_REALTIME = true;

        let block: RpcBlock | RpcBlockHeader;
        let isAccepted: boolean;

        for await (block of getRealtimeBlockGenerator(chain.id)) {
          // Note: The app can finalize blocks in a catch-up pass. It must not receive a
          // block at or before its finalized block.
          if (
            hexToNumber(block.number!) <=
            (APP_FINALIZED.get(chain.id) ?? Number.NEGATIVE_INFINITY)
          ) {
            continue;
          }
          isAccepted = await onBlock(block);
        }
        // Note: last block must be accepted before shutdown
        while (isAccepted! === false) {
          isAccepted = await onBlock(block!);
        }

        app.common.logger.warn({
          msg: `Realtime block subscription for chain '${chain.name}' completed`,
        });
        finishCount += 1;
        if (finishCount === app.indexingBuild.chains.length) {
          pwr.resolve();
        }
      })();
    };

    app.common.logger.warn({
      msg: `Mocking realtime block subscription for chain '${chain.name}'`,
    });
  }

  return app;
};

process.on("exit", (code) => {
  if (code !== 0) {
    console.log(`\nRecreate with 'SEED=${SEED} pnpm test ${APP_ID}'`);
  }
});

/**
 * Shuts down the app. Exits with an error if the shutdown takes too long.
 *
 * Note: `ponder start` exits the process 5 seconds after a shutdown starts. A shutdown that
 * does not complete is a bug, because the app keeps writing to the database.
 */
const shutdown = async (kill: () => Promise<void>) => {
  const timeout = setTimeout(() => {
    console.error(
      `ERROR: App did not shut down within ${SHUTDOWN_TIMEOUT / 1_000} seconds`,
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);
  await kill();
  clearTimeout(timeout);
};

/** Waits until the app is ready. */
const waitForReady = async () => {
  while (true) {
    try {
      const result = await fetch(`http://localhost:${PORT}/ready`);
      if (result.status === 200) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

// Run the previous config until the backfill is complete. It writes to the same sync store,
// so the tested config starts with sync data from a config that has the same addresses
// and blocks, but other factory, filter, receipt, and trace options.

if (SIM_PARAMS.PREVIOUS_RUN) {
  console.log("Running previous config");
  IS_PREVIOUS_RUN = true;
  process.env.SIM_PREVIOUS_RUN = "true";
  process.env.DATABASE_SCHEMA = "previous";

  const killPrevious = await start({
    cliOptions: {
      ...program.optsWithGlobals(),
      command: "start",
      version: packageJson.version,
      root: APP_DIR,
      config: "ponder.config.ts",
    },
    onBuild,
  });
  await waitForReady();
  await shutdown(killPrevious!);

  IS_PREVIOUS_RUN = false;
  delete process.env.SIM_PREVIOUS_RUN;
  process.env.DATABASE_SCHEMA = "public";
  console.log("Completed previous config");
}

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

setInterval(() => {
  console.log(APP_ID);
}, 5_000);

export const restart = async () => {
  if (RESTART_COUNT === 2) return;
  RESTART_COUNT += 1;
  console.log("Restarting app");
  await shutdown(kill!);
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

if (SIM_PARAMS.UNFINALIZED_BLOCKS === 0) {
  await waitForReady();
} else {
  await pwr.promise;
}

console.log("Killing app");

await shutdown(kill!);

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

console.log("Comparing tables");

const schema = await import(`../apps/${APP_ID}/ponder.schema.ts`);
for (const key of Object.keys(schema)) {
  if (APP_ID === "super-assessment" && key === "checkpoints") continue;

  if (is(schema[key], Table)) {
    const table = schema[key] as Table;
    const tableName = getTableName(table);

    await compareTables(
      APP_DB,
      table,
      `expected."${tableName}"`,
      `"${tableName}"`,
    );
  }
}

console.log("Updating metadata");

await DB.update(metadata).set({ success: true }).where(eq(metadata.id, UUID));

// await APP_DB_CLIENT.end();
// await DB_CLIENT.end();

process.exit(0);
