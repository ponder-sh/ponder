/**
 * The indexing functions of the generated apps. Each event draws its behavior
 * from the seed and its id, so it does the same thing every time it runs,
 * such as after a reorg or a restart.
 *
 * @dev Runs inside the generated app, through Vite, so it only imports `viem`,
 * `ponder`, and modules without other dependencies.
 */
import { eq } from "ponder";
import type { Address, Hex } from "viem";
import type { AppPlan } from "./plan.js";
import { Rng } from "./random.js";
import {
  EOAS,
  getTokens,
  multicall3Address,
  poolAbi,
  state,
  tokenAbi,
} from "./shared.js";

class SimulationAssertionError extends Error {
  // Note: `Error` subclasses inherit `name`, so it isn't the class name.
  override name = "SimulationAssertionError";
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SimulationAssertionError(message);
}

type Table = any;
type Event = any;
type Context = any;

const FIELDS = {
  block: [
    "hash",
    "number",
    "timestamp",
    "parentHash",
    "logsBloom",
    "miner",
    "gasUsed",
    "gasLimit",
    "baseFeePerGas",
    "nonce",
    "mixHash",
    "stateRoot",
    "receiptsRoot",
    "transactionsRoot",
    "sha3Uncles",
    "size",
    "difficulty",
    "totalDifficulty",
    "extraData",
  ],
  transaction: [
    "hash",
    "transactionIndex",
    "from",
    "to",
    "input",
    "value",
    "nonce",
    "r",
    "s",
    "v",
    "type",
    "gas",
    "gasPrice",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "accessList",
  ],
  transactionReceipt: [
    "contractAddress",
    "cumulativeGasUsed",
    "effectiveGasPrice",
    "from",
    "gasUsed",
    "logsBloom",
    "status",
    "to",
    "type",
  ],
  log: ["address", "data", "logIndex", "removed", "topics"],
  trace: [
    "type",
    "from",
    "to",
    "gas",
    "gasUsed",
    "input",
    "output",
    "value",
    "traceAddress",
  ],
} as const;

/** A JSON value for a `t.json()` column: bigints become strings. */
export const toJson = (value: unknown): unknown =>
  value === undefined
    ? null
    : JSON.parse(
        JSON.stringify(value, (_, v) =>
          typeof v === "bigint" ? v.toString() : v,
        ),
      );

/**
 * Create the indexing functions of an app.
 *
 * @returns `handle`, for events with a table, and `handleSetup`, for setup
 * events.
 */
export const createHandler = ({
  seed,
  app,
  tables: { simCheckpoint, simEntity, simClient },
}: {
  seed: string;
  app: Pick<AppPlan, "ordering" | "indexing">;
  tables: { simCheckpoint: Table; simEntity: Table; simClient: Table };
}) => {
  /** Count the setup events of each chain. */
  const handleSetup =
    (name: string) =>
    async ({ context }: { context: Context }) => {
      const chainId: number = context.chain.id;
      await context.db
        .insert(simEntity)
        .values({
          key: `setup:${name}:${chainId}`,
          chainId,
          count: 1,
          lastEventId: "",
        })
        .onConflictDoUpdate((row: { count: number }) => ({
          count: row.count + 1,
        }));
    };

  /**
   * @param table The table of the event.
   * @param row The columns of the row of the event, without `id` and
   * `chainId`.
   */
  const handle =
    (
      name: string,
      table: Table,
      row: (event: Event) => Record<string, unknown>,
    ) =>
    async ({ event, context }: { event: Event; context: Context }) => {
      const rng = new Rng(seed, `event:${name}:${event.id}`);
      const chainId: number = context.chain.id;

      // Note: Without skips, and in a plan from before `skipRate`, this draws
      // nothing, so the other draws of the event are unchanged.
      if (app.indexing.skipRate > 0 && rng.bool(app.indexing.skipRate)) return;

      // Events are in order, and not duplicated.
      const checkpointKey =
        app.ordering === "omnichain" ? "global" : `chain:${chainId}`;
      const previous = await context.db.find(simCheckpoint, {
        key: checkpointKey,
      });
      assert(
        // Note: Sources that match the same log or trace have events with
        // the same id.
        previous === null ||
          previous.eventId < event.id ||
          (previous.eventId === event.id && previous.name !== name),
        `Out of order event ${name} ${event.id} after ${previous?.name} ${previous?.eventId}`,
      );
      await context.db
        .insert(simCheckpoint)
        .values({ key: checkpointKey, eventId: event.id, name })
        .onConflictDoUpdate({ eventId: event.id, name });

      // Note: A duplicate event fails with a unique constraint error.
      await context.db
        .insert(table)
        .values({ id: event.id, chainId, ...row(event) });

      readEventFields(event, rng, app.indexing.fieldRate);

      if (rng.bool(app.indexing.dbRate))
        await entityOps(context, event, rng, simEntity, chainId, app);
      if (app.indexing.sql && rng.bool(app.indexing.dbRate / 2)) {
        await sqlOps(
          context,
          event,
          simEntity,
          simCheckpoint,
          checkpointKey,
          chainId,
        );
      }
      if (rng.bool(app.indexing.clientRate)) {
        await clientOps(name, context, event, rng, simClient, chainId);
      }
    };

  return { handle, handleSetup };
};

/**
 * Read random fields of the event, which changes the columns Ponder selects,
 * and check a few of them.
 */
const readEventFields = (event: Event, rng: Rng, rate: number) => {
  const read = (group: keyof typeof FIELDS, object: unknown) => {
    if (object === undefined || object === null) return;
    for (const field of FIELDS[group]) {
      if (rng.bool(rate)) (object as Record<string, unknown>)[field];
    }
  };

  read("block", event.block);
  read("transaction", event.transaction);
  read("transactionReceipt", event.transactionReceipt);
  read("log", event.log);
  read("trace", event.trace);

  assert(typeof event.block.number === "bigint", "block.number is a bigint");
  if (event.log && rng.bool(rate)) {
    assert(typeof event.log.logIndex === "number", "log.logIndex is a number");
  }
  if (event.transactionReceipt && rng.bool(rate)) {
    assert(
      event.transactionReceipt.from === event.transaction.from,
      "receipt and transaction have the same sender",
    );
    if (event.log) {
      assert(
        event.transactionReceipt.status === "success",
        "a transaction with logs succeeded",
      );
    }
  }
  if (event.trace && rng.bool(rate)) {
    assert(
      Array.isArray(event.trace.traceAddress),
      "trace.traceAddress is an array",
    );
  }
};

const entityOps = async (
  context: Context,
  event: Event,
  rng: Rng,
  simEntity: Table,
  chainId: number,
  app: Pick<AppPlan, "ordering">,
) => {
  const key =
    app.ordering === "omnichain" && rng.bool(0.3)
      ? `global:${rng.int(0, 7)}`
      : `${chainId}:${rng.int(0, 15)}`;
  const before = await context.db.find(simEntity, { key });
  if (before) {
    assert(
      // Note: Sources that match the same log or trace have events with the
      // same id.
      before.lastEventId <= event.id,
      `entity ${key} was written by a later event ${before.lastEventId} >= ${event.id}`,
    );
  }

  switch (
    rng.pick(["insert", "upsert", "update", "delete", "batch"] as const)
  ) {
    case "insert": {
      const inserted = await context.db
        .insert(simEntity)
        .values({ key, chainId, count: 1, lastEventId: event.id })
        .onConflictDoNothing();
      if (before)
        assert(inserted === null, "insert on conflict do nothing returns null");
      else assert(inserted?.key === key, "insert returns the row");
      break;
    }
    case "upsert": {
      const upserted = await context.db
        .insert(simEntity)
        .values({ key, chainId, count: 1, lastEventId: event.id })
        .onConflictDoUpdate((row: { count: number }) => ({
          count: row.count + 1,
          lastEventId: event.id,
        }));
      assert(
        upserted.count === (before ? before.count + 1 : 1),
        `upsert count ${upserted.count} after ${before?.count}`,
      );
      break;
    }
    case "update": {
      if (before === null) {
        let failed = false;
        try {
          await context.db
            .update(simEntity, { key })
            .set({ lastEventId: event.id });
        } catch {
          failed = true;
        }
        assert(failed, "update of a missing row fails");
        break;
      }
      const updated = await context.db
        .update(simEntity, { key })
        .set((row: { count: number }) => ({
          count: row.count * 2,
          lastEventId: event.id,
        }));
      assert(updated.count === before.count * 2, "update returns the row");
      break;
    }
    case "delete": {
      const deleted = await context.db.delete(simEntity, { key });
      assert(
        deleted === (before !== null),
        "delete returns whether the row existed",
      );
      const after = await context.db.find(simEntity, { key });
      assert(after === null, "deleted row is gone");
      break;
    }
    case "batch": {
      const keys = Array.from(
        new Set(
          Array.from(
            { length: rng.int(1, 5) },
            () => `${chainId}:batch:${rng.int(0, 31)}`,
          ),
        ),
      );
      const rows = await context.db
        .insert(simEntity)
        .values(
          keys.map((k) => ({
            key: k,
            chainId,
            count: 1,
            lastEventId: event.id,
          })),
        )
        .onConflictDoUpdate({ lastEventId: event.id });
      assert(rows.length === keys.length, "batch insert returns every row");
      break;
    }
  }
};

const sqlOps = async (
  context: Context,
  event: Event,
  simEntity: Table,
  simCheckpoint: Table,
  checkpointKey: string,
  chainId: number,
) => {
  // Note: Raw SQL reads flush the cache, so they see earlier writes.
  const rows = await context.db.sql
    .select()
    .from(simCheckpoint)
    .where(eq(simCheckpoint.key, checkpointKey));
  assert(
    rows.length === 1 && rows[0].eventId === event.id,
    "raw SQL sees the checkpoint",
  );

  // Note: A raw SQL write invalidates the cache, so the store reads it.
  const key = `${chainId}:sql:${event.id.slice(-4)}`;
  await context.db.sql
    .insert(simEntity)
    .values({ key, chainId, count: 1, lastEventId: event.id })
    .onConflictDoUpdate({
      target: simEntity.key,
      set: { lastEventId: event.id },
    });
  const written = await context.db.find(simEntity, { key });
  assert(written?.lastEventId === event.id, "the store reads a raw SQL write");
};

const clientOps = async (
  name: string,
  context: Context,
  event: Event,
  rng: Rng,
  simClient: Table,
  chainId: number,
) => {
  const tokens = getTokens(chainId);
  const token = rng.pick(tokens);
  const account = rng.pick(EOAS);
  const blockHash: Hex = event.block.hash;
  let method: string;
  let result: unknown;
  // Note: Results that depend on the block are checked after the run, against
  // the canonical chain. A reorg can change them before Ponder processes it.
  let expected: unknown;

  switch (
    rng.pick([
      "balanceOf",
      "name",
      "multicall",
      "getBalance",
      "getBlock",
      "getCode",
      "getReserves",
    ] as const)
  ) {
    case "balanceOf":
      method = "balanceOf";
      result = await context.client.readContract({
        abi: tokenAbi,
        address: token,
        functionName: "balanceOf",
        args: [account],
      });
      expected = state.balanceOf(blockHash, token, account);
      break;
    case "name":
      method = "name";
      result = await context.client.readContract({
        abi: tokenAbi,
        address: token,
        functionName: "name",
        cache: rng.bool(0.3) ? "immutable" : undefined,
      });
      assert(result === state.name(token), `name() of ${token}`);
      break;
    case "multicall":
      method = "multicall";
      // Note: The multicall3 of known chains is deployed after the blocks of
      // the simulated chains.
      result = await context.client.multicall({
        multicallAddress: multicall3Address,
        contracts: tokens.map((address) => ({
          abi: tokenAbi,
          address,
          functionName: "totalSupply",
        })),
        allowFailure: false,
      });
      expected = tokens.map((address) => state.totalSupply(blockHash, address));
      break;
    case "getBalance":
      method = "getBalance";
      result = await context.client.getBalance({ address: account });
      expected = state.balance(blockHash, account);
      break;
    case "getBlock": {
      method = "getBlock";
      const block = await context.client.getBlock({
        blockNumber: event.block.number,
      });
      assert(block.number === event.block.number, "getBlock returns the block");
      result = block.hash;
      expected = blockHash;
      break;
    }
    case "getCode": {
      method = "getCode";
      result = await context.client.getCode({ address: token });
      assert(result !== undefined && result !== "0x", "token has code");
      break;
    }
    case "getReserves": {
      method = "getReserves";
      // Note: Only a pool that exists at the block has reserves.
      const pool: Address | undefined = name.startsWith("Pool:")
        ? event.log.address
        : name.startsWith("Factory:")
          ? (event.args.pool ?? event.args.child)
          : undefined;
      if (pool === undefined) return;
      // Note: After a reorg that Ponder hasn't processed yet, the pool may
      // not exist at the block, and the call returns no data.
      result = await context.client
        .readContract({
          abi: poolAbi,
          address: pool,
          functionName: "getReserves",
        })
        .catch((error: Error) => {
          if (error.name === "ContractFunctionExecutionError") return "0x";
          throw error;
        });
      expected = state.getReserves(blockHash, pool, event.block.timestamp);
      break;
    }
  }

  await context.db
    .insert(simClient)
    .values({
      id: `${event.id}:${method}`,
      chainId,
      blockNumber: event.block.number,
      blockHash,
      method,
      result: toJson(result),
      expected: toJson(expected),
    })
    .onConflictDoNothing();
};
