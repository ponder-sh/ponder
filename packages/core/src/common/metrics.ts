import prometheus from "prom-client";

const databaseQueryDurationMs = [
  0.05, 0.1, 1, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1_000, 2_500, 5_000,
  7_500, 10_000, 25_000,
];

const httpRequestDurationMs = [
  5, 10, 25, 50, 75, 100, 250, 500, 750, 1_000, 2_500, 5_000, 7_500, 10_000,
  25_000,
];

const httpRequestSizeBytes = [
  10, 100, 1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000,
  10_000_000,
];

export class MetricsService {
  registry: prometheus.Registry;

  ponder_indexing_total_seconds: prometheus.Gauge;
  ponder_indexing_completed_seconds: prometheus.Gauge;
  ponder_indexing_completed_events: prometheus.Gauge<"network" | "event">;

  ponder_indexing_completed_timestamp: prometheus.Gauge;
  ponder_indexing_has_error: prometheus.Gauge;

  ponder_indexing_function_duration: prometheus.Histogram<"network" | "event">;
  ponder_indexing_function_error_total: prometheus.Counter<"network" | "event">;

  ponder_historical_start_timestamp: prometheus.Gauge<"network">;
  ponder_historical_total_blocks: prometheus.Gauge<
    "network" | "source" | "type"
  >;
  ponder_historical_cached_blocks: prometheus.Gauge<
    "network" | "source" | "type"
  >;
  ponder_historical_completed_blocks: prometheus.Gauge<
    "network" | "source" | "type"
  >;

  ponder_realtime_is_connected: prometheus.Gauge<"network">;
  ponder_realtime_latest_block_number: prometheus.Gauge<"network">;
  ponder_realtime_latest_block_timestamp: prometheus.Gauge<"network">;
  ponder_realtime_reorg_total: prometheus.Counter<"network">;

  ponder_database_method_duration: prometheus.Histogram<"service" | "method">;
  ponder_database_method_error_total: prometheus.Counter<"service" | "method">;

  ponder_http_server_port: prometheus.Gauge;
  ponder_http_server_active_requests: prometheus.Gauge<"method" | "path">;
  ponder_http_server_request_duration_ms: prometheus.Histogram<
    "method" | "path" | "status"
  >;
  ponder_http_server_request_size_bytes: prometheus.Histogram<
    "method" | "path" | "status"
  >;
  ponder_http_server_response_size_bytes: prometheus.Histogram<
    "method" | "path" | "status"
  >;

  ponder_rpc_request_duration: prometheus.Histogram<"network" | "method">;
  ponder_rpc_request_lag: prometheus.Histogram<"network" | "method">;

  ponder_postgres_pool_connections: prometheus.Gauge<"pool" | "kind"> = null!;
  ponder_postgres_query_queue_size: prometheus.Gauge<"pool"> = null!;
  ponder_postgres_query_total: prometheus.Counter<"pool"> = null!;

  ponder_sqlite_query_total: prometheus.Counter<"database"> = null!;

  constructor() {
    this.registry = new prometheus.Registry();

    this.ponder_indexing_total_seconds = new prometheus.Gauge({
      name: "ponder_indexing_total_seconds",
      help: "Total number of seconds that are required",
      registers: [this.registry],
    });
    this.ponder_indexing_completed_seconds = new prometheus.Gauge({
      name: "ponder_indexing_completed_seconds",
      help: "Number of seconds that have been completed",
      registers: [this.registry],
    });
    this.ponder_indexing_completed_events = new prometheus.Gauge({
      name: "ponder_indexing_completed_events",
      help: "Number of events that have been processed",
      labelNames: ["network", "event"] as const,
      registers: [this.registry],
    });
    this.ponder_indexing_completed_timestamp = new prometheus.Gauge({
      name: "ponder_indexing_completed_timestamp",
      help: "Timestamp through which all events have been completed",
      registers: [this.registry],
    });
    this.ponder_indexing_has_error = new prometheus.Gauge({
      name: "ponder_indexing_has_error",
      help: "Boolean (0 or 1) indicating if there is an indexing error",
      registers: [this.registry],
    });
    this.ponder_indexing_function_duration = new prometheus.Histogram({
      name: "ponder_indexing_function_duration",
      help: "Duration of indexing function execution",
      labelNames: ["network", "event"] as const,
      buckets: databaseQueryDurationMs,
      registers: [this.registry],
    });
    this.ponder_indexing_function_error_total = new prometheus.Counter({
      name: "ponder_indexing_function_error_total",
      help: "Total number of errors encountered during indexing function execution",
      labelNames: ["network", "event"] as const,
      registers: [this.registry],
    });

    this.ponder_historical_start_timestamp = new prometheus.Gauge({
      name: "ponder_historical_start_timestamp",
      help: "Unix timestamp (ms) when the historical sync service started",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_total_blocks = new prometheus.Gauge({
      name: "ponder_historical_total_blocks",
      help: "Number of blocks required for the historical sync",
      labelNames: ["network", "source", "type"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_cached_blocks = new prometheus.Gauge({
      name: "ponder_historical_cached_blocks",
      help: "Number of blocks that were found in the cache for the historical sync",
      labelNames: ["network", "source", "type"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_completed_blocks = new prometheus.Gauge({
      name: "ponder_historical_completed_blocks",
      help: "Number of blocks that have been processed for the historical sync",
      labelNames: ["network", "source", "type"] as const,
      registers: [this.registry],
    });

    this.ponder_realtime_is_connected = new prometheus.Gauge({
      name: "ponder_realtime_is_connected",
      help: "Boolean (0 or 1) indicating if the historical sync service is connected",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });
    this.ponder_realtime_latest_block_number = new prometheus.Gauge({
      name: "ponder_realtime_latest_block_number",
      help: "Block number of the latest synced block",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });
    this.ponder_realtime_latest_block_timestamp = new prometheus.Gauge({
      name: "ponder_realtime_latest_block_timestamp",
      help: "Block timestamp of the latest synced block",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });
    this.ponder_realtime_reorg_total = new prometheus.Counter({
      name: "ponder_realtime_reorg_total",
      help: "Count of how many re-orgs have occurred.",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });

    this.ponder_database_method_duration = new prometheus.Histogram({
      name: "ponder_database_method_duration",
      help: "Duration of database operations",
      labelNames: ["service", "method"] as const,
      buckets: databaseQueryDurationMs,
      registers: [this.registry],
    });
    this.ponder_database_method_error_total = new prometheus.Counter({
      name: "ponder_database_method_error_total",
      help: "Total number of errors encountered during database operations",
      labelNames: ["service", "method"] as const,
      registers: [this.registry],
    });

    this.ponder_http_server_port = new prometheus.Gauge({
      name: "ponder_http_server_port",
      help: "Port that the server is listening on",
      registers: [this.registry],
    });
    this.ponder_http_server_active_requests = new prometheus.Gauge({
      name: "ponder_http_server_active_requests",
      help: "Number of active HTTP server requests",
      labelNames: ["method", "path"] as const,
      registers: [this.registry],
    });
    this.ponder_http_server_request_duration_ms = new prometheus.Histogram({
      name: "ponder_http_server_request_duration_ms",
      help: "Duration of HTTP responses served the server",
      labelNames: ["method", "path", "status"] as const,
      buckets: httpRequestDurationMs,
      registers: [this.registry],
    });
    this.ponder_http_server_request_size_bytes = new prometheus.Histogram({
      name: "ponder_http_server_request_size_bytes",
      help: "Size of HTTP requests received by the server",
      labelNames: ["method", "path", "status"] as const,
      buckets: httpRequestSizeBytes,
      registers: [this.registry],
    });
    this.ponder_http_server_response_size_bytes = new prometheus.Histogram({
      name: "ponder_http_server_response_size_bytes",
      help: "Size of HTTP responses served the server",
      labelNames: ["method", "path", "status"] as const,
      buckets: httpRequestSizeBytes,
      registers: [this.registry],
    });

    this.ponder_rpc_request_duration = new prometheus.Histogram({
      name: "ponder_rpc_request_duration",
      help: "Duration of RPC requests",
      labelNames: ["network", "method"] as const,
      buckets: httpRequestDurationMs,
      registers: [this.registry],
    });
    this.ponder_rpc_request_lag = new prometheus.Histogram({
      name: "ponder_rpc_request_lag",
      help: "Time RPC requests spend waiting in the request queue",
      labelNames: ["network", "method"] as const,
      buckets: databaseQueryDurationMs,
      registers: [this.registry],
    });

    prometheus.collectDefaultMetrics({ register: this.registry });
  }

  /**
   * Get string representation for all metrics.
   * @returns Metrics encoded using Prometheus v0.0.4 format.
   */
  async getMetrics() {
    return await this.registry.metrics();
  }

  resetMetrics() {
    this.registry.resetMetrics();
  }
}

export async function getHistoricalSyncProgress(metrics: MetricsService) {
  // Historical sync table
  const startTimestampMetric =
    (await metrics.ponder_historical_start_timestamp.get()).values?.[0]
      ?.value ?? Date.now();

  /** Aggregate block metrics for different "types" of sources. */
  const reduceBlockMetrics = (
    values: prometheus.MetricValue<"network" | "source" | "type">[],
  ) =>
    values.reduce<{
      [id: string]: {
        labels: { source: string; network: string };
        value: number;
      };
    }>((acc, cur) => {
      const id = `${cur.labels.source}_${cur.labels.network}_${
        cur.labels.type === "block" ? "block" : "contract"
      }`;

      if (acc[id] === undefined) {
        acc[id] = {
          labels: {
            source: cur.labels.source as string,
            network: cur.labels.network as string,
          },
          value: cur.value,
        };
      } else {
        // Note: entries in `values` with the same `id` have the same "total"
        // block range. Using `Math.min()` ensures that a contract with both
        // "callTrace" and "log" type sources are displayed correctly.
        acc[id]!.value = Math.min(acc[id]!.value, cur.value);
      }

      return acc;
    }, {});

  const cachedBlocksMetric = await metrics.ponder_historical_cached_blocks
    .get()
    .then(({ values }) => reduceBlockMetrics(values));
  const totalBlocksMetric = await metrics.ponder_historical_total_blocks
    .get()
    .then(({ values }) => reduceBlockMetrics(values));
  const completedBlocksMetric = await metrics.ponder_historical_completed_blocks
    .get()
    .then(({ values }) => reduceBlockMetrics(values));

  const sources = Object.entries(totalBlocksMetric).map(
    ([
      id,
      {
        labels: { source, network },
        value: totalBlocks,
      },
    ]) => {
      const cachedBlocks = cachedBlocksMetric[id]?.value;
      const completedBlocks = completedBlocksMetric[id]?.value ?? 0;

      // If cachedBlocks is not set, setup is not complete.
      if (cachedBlocks === undefined) {
        return {
          sourceName: source,
          networkName: network,
          totalBlocks,
          completedBlocks,
        };
      }

      const progress = (completedBlocks + cachedBlocks) / totalBlocks;

      const elapsed = Date.now() - startTimestampMetric;
      const total = elapsed / (completedBlocks / (totalBlocks - cachedBlocks));
      // The ETA is low quality if we've completed only one or two blocks.
      const eta = completedBlocks >= 3 ? total - elapsed : undefined;

      return {
        sourceName: source,
        networkName: network,
        totalBlocks,
        cachedBlocks,
        completedBlocks,
        progress,
        eta,
      };
    },
  );

  const totalBlocks = sources.reduce((a, c) => a + c.totalBlocks, 0);
  const cachedBlocks = sources.reduce((a, c) => a + (c.cachedBlocks ?? 0), 0);
  const completedBlocks = sources.reduce(
    (a, c) => a + (c.completedBlocks ?? 0),
    0,
  );
  const progress =
    totalBlocks === 0 ? 0 : (completedBlocks + cachedBlocks) / totalBlocks;

  return {
    overall: { totalBlocks, cachedBlocks, completedBlocks, progress },
    sources,
  };
}

export async function getIndexingProgress(metrics: MetricsService) {
  const hasErrorMetric = (await metrics.ponder_indexing_has_error.get())
    .values[0]?.value;
  const hasError = hasErrorMetric === 1;

  const totalSeconds =
    (await metrics.ponder_indexing_total_seconds.get()).values[0]?.value ?? 0;
  const completedSeconds =
    (await metrics.ponder_indexing_completed_seconds.get()).values[0]?.value ??
    0;
  const completedToTimestamp =
    (await metrics.ponder_indexing_completed_timestamp.get()).values[0]!
      .value ?? 0;

  const progress = totalSeconds === 0 ? 0 : completedSeconds / totalSeconds;

  const indexingCompletedEventsMetric = (
    await metrics.ponder_indexing_completed_events.get()
  ).values;
  const indexingFunctionErrorMetric = (
    await metrics.ponder_indexing_function_error_total.get()
  ).values;
  const indexingFunctionDurationMetric = (
    await metrics.ponder_indexing_function_duration.get()
  ).values;

  const indexingDurationSum: Record<string, Record<string, number>> = {};
  const indexingDurationCount: Record<string, Record<string, number>> = {};
  for (const m of indexingFunctionDurationMetric) {
    if (m.metricName === "ponder_indexing_function_duration_sum")
      (indexingDurationSum[m.labels.event!] ??= {})[m.labels.network!] =
        m.value;
    if (m.metricName === "ponder_indexing_function_duration_count")
      (indexingDurationCount[m.labels.event!] ??= {})[m.labels.network!] =
        m.value;
  }

  const events = indexingCompletedEventsMetric.map((m) => {
    const eventName = m.labels.event as string;
    const networkName = m.labels.network as string;
    const count = m.value;

    const durationSum = indexingDurationSum[eventName]?.[networkName] ?? 0;
    const durationCount = indexingDurationCount[eventName]?.[networkName] ?? 0;
    const averageDuration =
      durationCount === 0 ? 0 : durationSum / durationCount;

    const errorCount =
      indexingFunctionErrorMetric.find(
        (e) => e.labels.event === eventName && e.labels.network === networkName,
      )?.value ?? 0;

    return { eventName, networkName, count, averageDuration, errorCount };
  });

  const totalEvents = events.reduce((a, e) => a + e.count, 0);

  return {
    hasError,
    overall: {
      completedSeconds,
      totalSeconds,
      progress,
      completedToTimestamp,
      totalEvents,
    },
    events,
  };
}
