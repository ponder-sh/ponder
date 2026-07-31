import { expect, test } from "vitest";
import { MetricsService } from "./metrics.js";

test("batches indexing metrics until collection", async () => {
  const metrics = new MetricsService();

  metrics.incrementIndexingCompletedEvents("Token:Transfer");
  metrics.incrementIndexingCompletedEvents("Token:Transfer", 2);
  metrics.incrementIndexingCacheRequests("account", "hit");
  metrics.incrementIndexingCacheRequests("account", "hit", 2);
  metrics.incrementIndexingCacheRequests("account", "prefetch", 0);
  metrics.incrementIndexingStoreQueries("account", "insert");
  metrics.incrementIndexingStoreQueries("account", "insert", 2);

  expect(await metrics.ponder_indexing_completed_events.get()).toMatchObject({
    values: [{ labels: { event: "Token:Transfer" }, value: 3 }],
  });
  expect(
    await metrics.ponder_indexing_cache_requests_total.get(),
  ).toMatchObject({
    values: [
      { labels: { table: "account", type: "hit" }, value: 3 },
      { labels: { table: "account", type: "prefetch" }, value: 0 },
    ],
  });
  expect(await metrics.ponder_indexing_store_queries_total.get()).toMatchObject(
    {
      values: [{ labels: { table: "account", method: "insert" }, value: 3 }],
    },
  );

  await metrics.getMetrics();

  expect(await metrics.ponder_indexing_completed_events.get()).toMatchObject({
    values: [{ labels: { event: "Token:Transfer" }, value: 3 }],
  });
});

test("flushes pending indexing metrics before reset", async () => {
  const metrics = new MetricsService();

  metrics.incrementIndexingCompletedEvents("Token:Transfer", 2);
  metrics.incrementIndexingCacheRequests("account", "hit", 3);
  metrics.incrementIndexingStoreQueries("account", "insert", 4);

  metrics.resetIndexingMetrics();

  expect(await metrics.ponder_indexing_completed_events.get()).toMatchObject({
    values: [],
  });
  expect(
    await metrics.ponder_indexing_cache_requests_total.get(),
  ).toMatchObject({
    values: [{ labels: { table: "account", type: "hit" }, value: 3 }],
  });
  expect(await metrics.ponder_indexing_store_queries_total.get()).toMatchObject(
    {
      values: [{ labels: { table: "account", method: "insert" }, value: 4 }],
    },
  );
});

test("does not replay flushed completed event metrics", async () => {
  const metrics = new MetricsService();

  metrics.incrementIndexingCompletedEvents("Token:Transfer", 2);
  metrics.flushIndexingMetrics();
  metrics.ponder_indexing_completed_events.set({ event: "Token:Transfer" }, 1);

  expect(await metrics.ponder_indexing_completed_events.get()).toMatchObject({
    values: [{ labels: { event: "Token:Transfer" }, value: 1 }],
  });
});
