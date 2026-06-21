import { createHash } from "node:crypto";
import { type Database, getPonderSinkDeliveryTable } from "@/database/index.js";
import type { QB } from "@/database/queryBuilder.js";
import type { Common } from "@/internal/common.js";
import { NonRetryableUserError } from "@/internal/errors.js";
import type {
  Event,
  FinalizedSinkBatch,
  FinalizedSinkEvent,
  IndexingSink,
  NamespaceBuild,
} from "@/internal/types.js";
import { asc, eq } from "drizzle-orm";
import superjson from "superjson";

export type SinkService = {
  start: () => Promise<void>;
  enqueue: (tx: QB, events: Event[]) => Promise<void>;
  drain: () => Promise<void>;
};

const createFinalizedSinkBatch = (events: Event[]): FinalizedSinkBatch => {
  const sortedEvents = events
    .slice()
    .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));

  const sinkEvents = sortedEvents.map(
    (event): FinalizedSinkEvent => ({
      id: event.event.id,
      checkpoint: event.checkpoint,
      chain: { id: event.chain.id, name: event.chain.name },
      name: event.eventCallback.name,
      type: event.type,
      event: event.event,
    }),
  );

  const checkpoint = sinkEvents[sinkEvents.length - 1]!.checkpoint;
  const id = createHash("sha256")
    .update(
      sinkEvents
        .map((event) => `${event.checkpoint}:${event.name}:${event.id}`)
        .join("\n"),
    )
    .digest("hex");

  return { version: 1, id, checkpoint, events: sinkEvents };
};

const getDeliveryId = ({
  sinkName,
  batchId,
}: {
  sinkName: string;
  batchId: string;
}): string => {
  return createHash("sha256").update(`${sinkName}:${batchId}`).digest("hex");
};

export const createSinkService = ({
  common,
  database,
  namespace,
  sinks,
}: {
  common: Common;
  database: Database;
  namespace: NamespaceBuild;
  sinks: readonly IndexingSink[];
}): SinkService => {
  const PONDER_SINK_DELIVERY = getPonderSinkDeliveryTable(namespace.schema);

  const drain = async (): Promise<void> => {
    for (const sink of sinks) {
      const deliveries = await database.userQB.wrap(
        { label: "get_sink_delivery" },
        (db) =>
          db
            .select()
            .from(PONDER_SINK_DELIVERY)
            .where(eq(PONDER_SINK_DELIVERY.sinkName, sink.name))
            .orderBy(
              asc(PONDER_SINK_DELIVERY.checkpoint),
              asc(PONDER_SINK_DELIVERY.id),
            ),
      );

      for (const delivery of deliveries) {
        const batch = superjson.parse<FinalizedSinkBatch>(delivery.payload);

        try {
          await sink.writeFinalizedBatch(batch);
        } catch (error) {
          common.logger.error({
            msg: "Failed finalized sink delivery",
            sink: sink.name,
            checkpoint: batch.checkpoint,
            batch_id: batch.id,
            error: error as Error,
          });
          throw error;
        }

        await database.userQB.wrap({ label: "delete_sink_delivery" }, (db) =>
          db
            .delete(PONDER_SINK_DELIVERY)
            .where(eq(PONDER_SINK_DELIVERY.id, delivery.id)),
        );

        common.logger.debug({
          msg: "Delivered finalized sink batch",
          sink: sink.name,
          checkpoint: batch.checkpoint,
          batch_id: batch.id,
          event_count: batch.events.length,
        });
      }
    }
  };

  return {
    async start(): Promise<void> {
      if (sinks.length > 0 && database.userQB.$dialect === "pglite") {
        throw new NonRetryableUserError(
          "Finalized sinks require a Postgres database because PGlite does not provide durable transaction boundaries.",
        );
      }

      for (const sink of sinks) {
        await sink.setup?.();
      }

      common.shutdown.add(async () => {
        await Promise.all(
          sinks.map(async (sink) => {
            await sink.flush?.();
            await sink.shutdown?.();
          }),
        );
      });

      await drain();
    },
    async enqueue(tx: QB, events: Event[]): Promise<void> {
      if (sinks.length === 0 || events.length === 0) return;

      const batch = createFinalizedSinkBatch(events);
      await tx.wrap({ label: "enqueue_sink_delivery" }, (db) =>
        db
          .insert(PONDER_SINK_DELIVERY)
          .values(
            sinks.map((sink) => ({
              id: getDeliveryId({ sinkName: sink.name, batchId: batch.id }),
              sinkName: sink.name,
              checkpoint: batch.checkpoint,
              payload: superjson.stringify(batch),
              createdAt: Date.now(),
            })),
          )
          .onConflictDoNothing(),
      );
    },
    drain,
  };
};
