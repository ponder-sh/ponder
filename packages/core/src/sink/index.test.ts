import {
  context,
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getChain } from "@/_test/utils.js";
import { finalizeMultichain } from "@/database/actions.js";
import {
  type Database,
  getPonderCheckpointTable,
  getPonderSinkDeliveryTable,
} from "@/database/index.js";
import { NonRetryableUserError } from "@/internal/errors.js";
import type {
  Chain,
  Event,
  FinalizedSinkBatch,
  IndexingSink,
} from "@/internal/types.js";
import { getFinalizedEventsMultichain } from "@/runtime/realtime.js";
import { ZERO_CHECKPOINT, encodeCheckpoint } from "@/utils/checkpoint.js";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import { createSinkService } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

const namespace = { schema: "public", viewsSchema: undefined };

const createCheckpoint = ({
  chainId,
  blockNumber = 0n,
  blockTimestamp = 0n,
}: {
  chainId: number;
  blockNumber?: bigint;
  blockTimestamp?: bigint;
}) =>
  encodeCheckpoint({
    ...ZERO_CHECKPOINT,
    chainId: BigInt(chainId),
    blockNumber,
    blockTimestamp,
  });

const createEvent = ({
  id = "event-1",
  chain = getChain(),
  checkpoint = createCheckpoint({ chainId: chain.id, blockNumber: 1n }),
}: {
  id?: string;
  chain?: Chain;
  checkpoint?: string;
} = {}): Event => {
  return {
    type: "block",
    checkpoint,
    chain,
    eventCallback: {
      filter: {
        type: "block",
        chainId: chain.id,
        sourceId: "Block",
        interval: 1,
        offset: 0,
        fromBlock: undefined,
        toBlock: undefined,
        hasTransactionReceipt: false,
        include: [],
      },
      name: "Block",
      fn: () => {},
      chain,
      type: "block",
    },
    event: {
      id,
      block: { hash: "0x", number: 1n, timestamp: 1n },
    },
  };
};

const getPendingDeliveries = (database: Database) => {
  const PONDER_SINK_DELIVERY = getPonderSinkDeliveryTable(namespace.schema);

  return database.userQB.wrap((db) => db.select().from(PONDER_SINK_DELIVERY));
};

test("replays a multichain delivery after finalizing its chain", async () => {
  if (context.databaseConfig.kind !== "postgres") return;

  const { database } = await setupDatabaseServices({
    namespaceBuild: namespace,
  });
  const chainA = getChain();
  const chainB = { ...getChain(), id: 2, name: "optimism" };
  const checkpointA = createCheckpoint({
    chainId: chainA.id,
    blockNumber: 1n,
    blockTimestamp: 1n,
  });
  const checkpointB = createCheckpoint({
    chainId: chainB.id,
    blockNumber: 1n,
    blockTimestamp: 2n,
  });
  const initialCheckpointA = createCheckpoint({ chainId: chainA.id });
  const initialCheckpointB = createCheckpoint({ chainId: chainB.id });
  const PONDER_CHECKPOINT = getPonderCheckpointTable(namespace.schema);

  await database.userQB.wrap((tx) =>
    tx.insert(PONDER_CHECKPOINT).values([
      {
        chainName: chainA.name,
        chainId: chainA.id,
        latestCheckpoint: checkpointA,
        safeCheckpoint: initialCheckpointA,
        finalizedCheckpoint: initialCheckpointA,
      },
      {
        chainName: chainB.name,
        chainId: chainB.id,
        latestCheckpoint: checkpointB,
        safeCheckpoint: initialCheckpointB,
        finalizedCheckpoint: initialCheckpointB,
      },
    ]),
  );

  const eventA = createEvent({
    id: "event-a",
    chain: chainA,
    checkpoint: checkpointA,
  });
  const eventB = createEvent({
    id: "event-b",
    chain: chainB,
    checkpoint: checkpointB,
  });
  const { finalizedEvents } = getFinalizedEventsMultichain([eventA, eventB], {
    chain: chainB,
    checkpoint: checkpointB,
  });
  const service = createSinkService({
    common: context.common,
    database,
    namespace,
    sinks: [{ name: "test", writeFinalizedBatch: async () => {} }],
  });

  await finalizeMultichain(database.userQB, {
    checkpoint: checkpointB,
    tables: [],
    namespaceBuild: namespace,
    onFinalize: (tx) => service.enqueue(tx, finalizedEvents),
  });

  const checkpointARow = await database.userQB.wrap((tx) =>
    tx
      .select()
      .from(PONDER_CHECKPOINT)
      .where(eq(PONDER_CHECKPOINT.chainId, chainA.id))
      .then((rows) => rows[0]),
  );
  const checkpointBRow = await database.userQB.wrap((tx) =>
    tx
      .select()
      .from(PONDER_CHECKPOINT)
      .where(eq(PONDER_CHECKPOINT.chainId, chainB.id))
      .then((rows) => rows[0]),
  );

  expect(checkpointARow!.finalizedCheckpoint).toBe(initialCheckpointA);
  expect(checkpointBRow!.finalizedCheckpoint).toBe(checkpointB);
  expect(await getPendingDeliveries(database)).toHaveLength(1);

  const delivered: FinalizedSinkBatch[] = [];
  const restartedService = createSinkService({
    common: context.common,
    database,
    namespace,
    sinks: [
      {
        name: "test",
        writeFinalizedBatch: async (batch) => {
          delivered.push(batch);
        },
      },
    ],
  });

  await restartedService.drain();

  expect(delivered).toHaveLength(1);
  expect(delivered[0]!.events).toMatchObject([{ id: "event-b" }]);
  expect(await getPendingDeliveries(database)).toHaveLength(0);
});

test("drains a persisted finalized batch", async () => {
  const { database } = await setupDatabaseServices({
    namespaceBuild: namespace,
  });
  const writeFinalizedBatch = vi.fn(async (_batch: FinalizedSinkBatch) => {});
  const sink = {
    name: "test",
    writeFinalizedBatch,
  } satisfies IndexingSink;
  const service = createSinkService({
    common: context.common,
    database,
    namespace,
    sinks: [sink],
  });

  await database.userQB.transaction((tx) =>
    service.enqueue(tx, [createEvent()]),
  );

  expect(writeFinalizedBatch).not.toHaveBeenCalled();
  expect(await getPendingDeliveries(database)).toHaveLength(1);

  await service.drain();

  expect(writeFinalizedBatch).toHaveBeenCalledTimes(1);
  expect(writeFinalizedBatch.mock.calls[0]![0]).toMatchObject({
    version: 1,
    events: [{ id: "event-1", name: "Block", type: "block" }],
  });
  expect(
    writeFinalizedBatch.mock.calls[0]![0].events[0]!.event.block.number,
  ).toBe(1n);
  expect(await getPendingDeliveries(database)).toHaveLength(0);
});

test("replays an unacknowledged delivery", async () => {
  const { database } = await setupDatabaseServices({
    namespaceBuild: namespace,
  });
  const writeFinalizedBatch = vi
    .fn(async (_batch: FinalizedSinkBatch) => {})
    .mockRejectedValueOnce(new Error("unavailable"));
  const service = createSinkService({
    common: context.common,
    database,
    namespace,
    sinks: [{ name: "test", writeFinalizedBatch } satisfies IndexingSink],
  });

  await database.userQB.transaction((tx) =>
    service.enqueue(tx, [createEvent()]),
  );

  await expect(service.drain()).rejects.toThrow("unavailable");
  expect(await getPendingDeliveries(database)).toHaveLength(1);

  const replayedBatches: FinalizedSinkBatch[] = [];
  const restartedService = createSinkService({
    common: context.common,
    database,
    namespace,
    sinks: [
      {
        name: "test",
        writeFinalizedBatch: async (batch) => {
          replayedBatches.push(batch);
        },
      },
    ],
  });

  await restartedService.drain();

  expect(writeFinalizedBatch).toHaveBeenCalledTimes(1);
  expect(replayedBatches).toHaveLength(1);
  expect(replayedBatches[0]!.id).toBe(writeFinalizedBatch.mock.calls[0]![0].id);
  expect(await getPendingDeliveries(database)).toHaveLength(0);
});

test("rejects sinks with PGlite", async () => {
  if (context.databaseConfig.kind === "postgres") return;

  const { database } = await setupDatabaseServices({
    namespaceBuild: namespace,
  });
  const setup = vi.fn(async () => {});
  const service = createSinkService({
    common: context.common,
    database,
    namespace,
    sinks: [{ name: "test", setup, writeFinalizedBatch: async () => {} }],
  });

  await expect(service.start()).rejects.toThrow("require a Postgres database");
  expect(setup).not.toHaveBeenCalled();
});

test("does not persist a rolled back delivery", async () => {
  if (context.databaseConfig.kind !== "postgres") return;

  const { database } = await setupDatabaseServices({
    namespaceBuild: namespace,
  });
  const service = createSinkService({
    common: context.common,
    database,
    namespace,
    sinks: [{ name: "test", writeFinalizedBatch: async () => {} }],
  });

  await expect(
    database.userQB.transaction(async (tx) => {
      await service.enqueue(tx, [createEvent()]);
      throw new NonRetryableUserError("rollback");
    }),
  ).rejects.toThrow("rollback");

  expect(await getPendingDeliveries(database)).toHaveLength(0);
});

test("runs the sink lifecycle", async () => {
  const setup = vi.fn(async () => {});
  const flush = vi.fn(async () => {});
  const shutdown = vi.fn(async () => {});
  const service = createSinkService({
    common: context.common,
    database: {
      userQB: {
        $dialect: "postgres",
        wrap: async () => [],
      },
    } as unknown as Database,
    namespace,
    sinks: [
      {
        name: "test",
        setup,
        writeFinalizedBatch: async () => {},
        flush,
        shutdown,
      },
    ],
  });

  await service.start();
  await context.common.shutdown.kill();

  expect(setup).toHaveBeenCalledTimes(1);
  expect(flush).toHaveBeenCalledTimes(1);
  expect(shutdown).toHaveBeenCalledTimes(1);
});
