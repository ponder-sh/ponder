import pg from "pg";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  MAX_CHECKPOINT,
} from "@/utils/checkpoint.js";
import { tableName } from "./app.js";
import type { SimChain } from "./chain.js";
import type { AppPlan, Plan } from "./plan.js";

/**
 * Check the database after the last run: the `latest_checkpoint` of each chain
 * is at or after every event of the chain that the apps indexed, and, with
 * omnichain ordering, at or after the end block of a chain that only requires
 * backfill once an event of another chain after it is indexed, or of every
 * chain once the backfill is complete and the end block of every chain is
 * finalized, and the `finalized_checkpoint` of a live chain is at most
 * `reorgWindow` and two blocks behind the `latest_checkpoint` of each live
 * chain. The `latest_checkpoint` of a chain whose sources all end is at or
 * before the last end block, each block of a block source at or before
 * the `safe_checkpoint` of its chain is canonical, and each `context.client`
 * result at a canonical block is the result of the canonical chain.
 *
 * @returns A description of the first violation, or `undefined`.
 */
export const checkDatabase = async ({
  plan,
  chains,
  databaseUrl,
}: {
  plan: Plan;
  chains: SimChain[];
  databaseUrl: string;
}): Promise<string | undefined> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const apps = new Set(plan.runs.map((run) => plan.apps[run.app]!));
    for (const app of apps) {
      const schema = app.id;
      // Note: The tables of events have `id`, the checkpoint of the event, and
      // `chain_id` columns.
      const { rows: tables } = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.columns
        WHERE table_schema = $1 AND column_name IN ('id', 'chain_id')
          AND table_name NOT LIKE '\\_%' AND table_name <> 'sim_client'
        GROUP BY table_name HAVING count(*) = 2
        ORDER BY table_name`,
        [schema],
      );
      if (tables.length === 0) continue;

      const { rows: checkpoints } = await client.query<{
        chain_id: string;
        latest_checkpoint: string;
        finalized_checkpoint: string;
      }>(
        `SELECT chain_id, latest_checkpoint, finalized_checkpoint FROM "${schema}"._ponder_checkpoint`,
      );
      const latest = new Map(
        checkpoints.map((row) => [Number(row.chain_id), row.latest_checkpoint]),
      );

      for (const chain of plan.chains) {
        if (app.chains.includes(chain.name) === false) continue;
        const checkpoint = latest.get(chain.id);
        const endBlocks = getEndBlocks(app, chain.name);
        if (
          checkpoint === undefined ||
          endBlocks.length === 0 ||
          endBlocks.includes(undefined)
        )
          continue;
        const endBlock = Math.max(...(endBlocks as number[]));
        if (decodeCheckpoint(checkpoint).blockNumber > BigInt(endBlock)) {
          return `latest_checkpoint ${checkpoint} of chain ${chain.id} in schema "${schema}" is after its end block ${endBlock}`;
        }
      }

      // Note: Crash recovery keeps the rows at or before the safe checkpoint.
      for (const block of app.blocks) {
        const { rows } = await client.query<{
          id: string;
          chain_id: number;
          block_number: string;
          hash: string;
        }>(
          `SELECT t.id, t.chain_id, t.block_number, t.hash
          FROM "${schema}"."${tableName(`${block.name}:block`)}" t
          JOIN "${schema}"._ponder_checkpoint c ON c.chain_id = t.chain_id
          WHERE t.id <= c.safe_checkpoint ORDER BY t.id`,
        );
        for (const row of rows) {
          const chain = chains.find((chain) => chain.plan.id === row.chain_id)!;
          if (chain.canonical[Number(row.block_number)]?.hash !== row.hash) {
            return `block ${row.block_number} ${row.hash} of chain ${row.chain_id} in schema "${schema}" is at or before the safe_checkpoint, but isn't canonical`;
          }
        }
      }

      // Note: A provider that lags behind another can still have a reorged
      // block at a number, so only chains whose providers lag the same are
      // checked.
      const { rows: clientRows } = await client.query<{
        id: string;
        chain_id: number;
        block_number: string;
        block_hash: string;
        result: unknown;
        expected: unknown;
      }>(
        `SELECT id, chain_id, block_number, block_hash, result, expected
        FROM "${schema}".sim_client WHERE expected IS NOT NULL ORDER BY id`,
      );
      for (const row of clientRows) {
        const chain = chains.find((chain) => chain.plan.id === row.chain_id)!;
        const lags = new Set(chain.plan.rpcs.map((rpc) => rpc.lag));
        if (
          lags.size === 1 &&
          chain.canonical[Number(row.block_number)]?.hash === row.block_hash &&
          JSON.stringify(row.result) !== JSON.stringify(row.expected)
        ) {
          return `context.client result ${JSON.stringify(row.result)} of "${row.id}" on chain ${row.chain_id} in schema "${schema}" isn't the result ${JSON.stringify(row.expected)} at its canonical block ${row.block_number}`;
        }
      }

      /** The last indexed event of each chain. */
      const lastEvents = new Map<number, string>();
      for (const { table_name } of tables) {
        const { rows } = await client.query<{ chain_id: number; id: string }>(
          `SELECT chain_id, max(id) AS id FROM "${schema}"."${table_name}" GROUP BY chain_id ORDER BY chain_id`,
        );
        for (const { chain_id, id } of rows) {
          const checkpoint = latest.get(chain_id);
          if (checkpoint === undefined || id > checkpoint) {
            return `latest_checkpoint ${checkpoint} of chain ${chain_id} in schema "${schema}" is before event ${id} of table "${table_name}"`;
          }
          if (id > (lastEvents.get(chain_id) ?? "")) {
            lastEvents.set(chain_id, id);
          }
        }
      }

      if (app.ordering !== "omnichain") continue;
      const {
        rows: [meta],
      } = await client.query<{ is_ready: string }>(
        `SELECT value->>'is_ready' AS is_ready FROM "${schema}"._ponder_meta`,
      );
      const endedChains = getEndedChains(plan, app);
      // Note: The backfill is complete once the app is ready. With live
      // chains, it can leave events of a chain that only requires backfill
      // for live indexing, which are indexed once the end block of every chain
      // is finalized, given a minute to poll and index.
      const lastRun = plan.runs.findLast((run) => plan.apps[run.app] === app)!;
      const finalizedChains = getChainsFinalizedAt(
        plan,
        app,
        plan.startTime + lastRun.stopAt - 60_000,
      );
      const isComplete =
        meta?.is_ready === "1" && finalizedChains.length === app.chains.length;
      for (const { id, endBlock } of isComplete
        ? finalizedChains
        : endedChains) {
        const checkpoint = latest.get(id)!;
        const end = getChainCheckpoint(plan, id, endBlock);
        const isPassed = [...lastEvents].some(
          ([chainId, other]) => chainId !== id && other > end,
        );
        if (
          (isPassed || isComplete) &&
          decodeCheckpoint(checkpoint).blockNumber < BigInt(endBlock)
        ) {
          return `latest_checkpoint ${checkpoint} of chain ${id} in schema "${schema}" is before its end block ${endBlock}`;
        }
      }

      // Note: A block is finalized once a block `reorgWindow` seconds after it
      // is synced. A chain holds back the finalized checkpoint until its end
      // block is finalized.
      const liveChains = getLiveChains(plan, app, finalizedChains, latest);
      if (liveChains.length === 0) continue;
      const bound = liveChains
        .map(
          (chain) =>
            decodeCheckpoint(latest.get(chain.id)!).blockTimestamp -
            BigInt(chain.reorgWindow + Math.ceil(2 * chain.blockTime)),
        )
        .reduce((a, b) => (a < b ? a : b));
      for (const { chain_id, finalized_checkpoint } of checkpoints) {
        if (liveChains.some((chain) => chain.id === Number(chain_id))) {
          if (decodeCheckpoint(finalized_checkpoint).blockTimestamp < bound) {
            return `finalized_checkpoint ${finalized_checkpoint} of chain ${chain_id} in schema "${schema}" is more than reorgWindow behind the latest_checkpoint of a live chain`;
          }
        }
      }
    }
    return undefined;
  } finally {
    await client.end();
  }
};

/**
 * The chains of `app` whose sources all end at a block that was finalized when
 * the last run of `app` started, with the last end block.
 */
const getEndedChains = (plan: Plan, app: AppPlan) => {
  const lastRun = plan.runs.findLastIndex((run) => plan.apps[run.app] === app);
  const startedAt =
    plan.startTime + (lastRun === 0 ? 0 : plan.runs[lastRun - 1]!.stopAt);
  return getChainsFinalizedAt(plan, app, startedAt);
};

/**
 * The chains of `app` whose sources all end at a block that is finalized at
 * virtual time `at`, with the last end block.
 */
const getChainsFinalizedAt = (plan: Plan, app: AppPlan, at: number) =>
  plan.chains.flatMap((chain) => {
    if (app.chains.includes(chain.name) === false) return [];
    const endBlocks = getEndBlocks(app, chain.name);
    if (endBlocks.length === 0 || endBlocks.includes(undefined)) return [];
    const endBlock = Math.max(...(endBlocks as number[]));

    // Note: The finalized block at startup is `reorgWindow` behind the latest
    // block of a provider, which lags by up to `lag` and is up to a block old.
    const lag = Math.max(...chain.rpcs.map((rpc) => rpc.lag));
    const finalizedAt =
      at - lag - chain.reorgWindow * 1_000 - 2 * chain.blockTime * 1_000;
    const minedAt =
      (chain.genesisTimestamp + endBlock * chain.blockTime) * 1_000;
    return minedAt <= finalizedAt ? [{ id: chain.id, endBlock }] : [];
  });

/**
 * The chains of `app` that hold back the finalized checkpoint: a chain with a
 * source without an end block, or with an end block that isn't in
 * `finalizedChains`.
 */
const getLiveChains = (
  plan: Plan,
  app: AppPlan,
  finalizedChains: { id: number }[],
  latest: Map<number, string>,
) =>
  plan.chains.filter((chain) => {
    if (app.chains.includes(chain.name) === false) return false;
    if (finalizedChains.some(({ id }) => id === chain.id)) return false;
    return (
      latest.get(chain.id) !== undefined &&
      getEndBlocks(app, chain.name).length > 0
    );
  });

/** The end blocks of the sources of `app` on chain `name`. */
const getEndBlocks = (app: AppPlan, name: string) =>
  [
    ...app.contracts.map((contract) => contract.chains[name]),
    ...app.accounts.map((account) => account.chains[name]),
    ...app.blocks.map((block) => block.chains[name]),
  ]
    .filter((range) => range !== undefined)
    .map((range) => range.endBlock);

/** The checkpoint at the end of block `number` of chain `id`. */
const getChainCheckpoint = (plan: Plan, id: number, number: number) => {
  const chain = plan.chains.find((chain) => chain.id === id)!;
  return encodeCheckpoint({
    ...MAX_CHECKPOINT,
    blockTimestamp: BigInt(
      Math.floor(
        Math.round(
          (chain.genesisTimestamp + number * chain.blockTime) * 1_000,
        ) / 1_000,
      ),
    ),
    chainId: BigInt(id),
    blockNumber: BigInt(number),
  });
};
