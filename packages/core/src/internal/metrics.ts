import { truncate } from "@/utils/truncate.js";
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
  start_timestamp: number;
  rps: { [network: string]: { count: number; timestamp: number }[] };

  ponder_version_info: prometheus.Gauge<
    "version" | "major" | "minor" | "patch"
  >;
  ponder_settings_info: prometheus.Gauge<"ordering" | "database" | "command">;

  ponder_historical_start_timestamp_seconds: prometheus.Gauge;
  ponder_historical_end_timestamp_seconds: prometheus.Gauge;

  ponder_historical_total_indexing_seconds: prometheus.Gauge<"network">;
  ponder_historical_cached_indexing_seconds: prometheus.Gauge<"network">;
  ponder_historical_completed_indexing_seconds: prometheus.Gauge<"network">;

  ponder_indexing_timestamp: prometheus.Gauge<"network">;
  ponder_indexing_has_error: prometheus.Gauge<"network">;

  ponder_indexing_completed_events: prometheus.Gauge<"event">;
  ponder_indexing_function_duration: prometheus.Histogram<"event">;
  ponder_indexing_abi_decoding_duration: prometheus.Histogram;
  ponder_indexing_cache_requests_total: prometheus.Counter<"table" | "type">;
  ponder_indexing_cache_query_duration: prometheus.Histogram<
    "table" | "method"
  >;
  ponder_indexing_store_queries_total: prometheus.Counter<"table" | "method">;
  ponder_indexing_store_raw_sql_duration: prometheus.Histogram;

  ponder_sync_block: prometheus.Gauge<"network">;
  ponder_sync_is_realtime: prometheus.Gauge<"network">;
  ponder_sync_is_complete: prometheus.Gauge<"network">;

  ponder_historical_duration: prometheus.Histogram<"network">;
  ponder_historical_total_blocks: prometheus.Gauge<"network">;
  ponder_historical_cached_blocks: prometheus.Gauge<"network">;
  ponder_historical_completed_blocks: prometheus.Gauge<"network">;

  ponder_realtime_reorg_total: prometheus.Counter<"network">;
  ponder_realtime_latency: prometheus.Histogram<"network">;

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

  ponder_postgres_query_total: prometheus.Counter<"pool">;
  ponder_postgres_query_queue_size: prometheus.Gauge<"pool"> = null!;
  ponder_postgres_pool_connections: prometheus.Gauge<"pool" | "kind"> = null!;

  constructor() {
    this.registry = new prometheus.Registry();
    this.start_timestamp = Date.now();
    this.rps = {};

    this.ponder_version_info = new prometheus.Gauge({
      name: "ponder_version_info",
      help: "Ponder version information",
      labelNames: ["version", "major", "minor", "patch"] as const,
      registers: [this.registry],
    });
    this.ponder_settings_info = new prometheus.Gauge({
      name: "ponder_settings_info",
      help: "Ponder settings information",
      labelNames: ["ordering", "database", "command"] as const,
      registers: [this.registry],
    });

    this.ponder_historical_start_timestamp_seconds = new prometheus.Gauge({
      name: "ponder_historical_start_timestamp_seconds",
      help: "Timestamp at which historical indexing started",
      registers: [this.registry],
    });
    this.ponder_historical_end_timestamp_seconds = new prometheus.Gauge({
      name: "ponder_historical_end_timestamp_seconds",
      help: "Timestamp at which historical indexing ended",
      registers: [this.registry],
    });

    this.ponder_historical_total_indexing_seconds = new prometheus.Gauge({
      name: "ponder_historical_total_indexing_seconds",
      help: "Total number of seconds that are required",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_cached_indexing_seconds = new prometheus.Gauge({
      name: "ponder_historical_cached_indexing_seconds",
      help: "Number of seconds that have been cached",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_completed_indexing_seconds = new prometheus.Gauge({
      name: "ponder_historical_completed_indexing_seconds",
      help: "Number of seconds that have been completed",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });
    this.ponder_indexing_completed_events = new prometheus.Gauge({
      name: "ponder_indexing_completed_events",
      help: "Number of events that have been processed",
      labelNames: ["network", "event"] as const,
      registers: [this.registry],
    });
    this.ponder_indexing_timestamp = new prometheus.Gauge({
      name: "ponder_indexing_timestamp",
      help: "Timestamp through which all events have been completed",
      labelNames: ["network"] as const,
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
    this.ponder_indexing_abi_decoding_duration = new prometheus.Histogram({
      name: "ponder_indexing_abi_decoding_duration",
      help: "Total time spent decoding log arguments and call trace arguments and results",
      buckets: databaseQueryDurationMs,
      registers: [this.registry],
    });
    this.ponder_indexing_cache_query_duration = new prometheus.Histogram({
      name: "ponder_indexing_cache_query_duration",
      help: "Duration of cache operations",
      labelNames: ["table", "method"] as const,
      buckets: databaseQueryDurationMs,
      registers: [this.registry],
    });
    this.ponder_indexing_cache_requests_total = new prometheus.Counter({
      name: "ponder_indexing_cache_requests_total",
      help: "Number of cache accesses",
      labelNames: ["table", "type"] as const,
      registers: [this.registry],
    });
    this.ponder_indexing_store_queries_total = new prometheus.Counter({
      name: "ponder_indexing_store_queries_total",
      help: "Number of indexing store operations",
      labelNames: ["table", "method"] as const,
      registers: [this.registry],
    });
    this.ponder_indexing_store_raw_sql_duration = new prometheus.Histogram({
      name: "ponder_indexing_store_raw_sql_duration",
      help: "Duration of raw SQL store operations",
      buckets: databaseQueryDurationMs,
      registers: [this.registry],
    });

    this.ponder_sync_block = new prometheus.Gauge({
      name: "ponder_sync_block",
      help: "Closest-to-tip synced block number",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });
    this.ponder_sync_is_realtime = new prometheus.Gauge({
      name: "ponder_sync_is_realtime",
      help: "Boolean (0 or 1) indicating if the sync is realtime mode",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });
    this.ponder_sync_is_complete = new prometheus.Gauge({
      name: "ponder_sync_is_complete",
      help: "Boolean (0 or 1) indicating if the sync has synced all blocks",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });

    this.ponder_historical_duration = new prometheus.Histogram({
      name: "ponder_historical_duration",
      help: "Duration of historical sync execution",
      labelNames: ["network"] as const,
      buckets: httpRequestDurationMs,
      registers: [this.registry],
    });
    this.ponder_historical_total_blocks = new prometheus.Gauge({
      name: "ponder_historical_total_blocks",
      help: "Number of blocks required for the historical sync",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_cached_blocks = new prometheus.Gauge({
      name: "ponder_historical_cached_blocks",
      help: "Number of blocks that were found in the cache for the historical sync",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_completed_blocks = new prometheus.Gauge({
      name: "ponder_historical_completed_blocks",
      help: "Number of blocks that have been processed for the historical sync",
      labelNames: ["network", "source", "type"] as const,
      registers: [this.registry],
    });

    this.ponder_realtime_reorg_total = new prometheus.Counter({
      name: "ponder_realtime_reorg_total",
      help: "Count of how many re-orgs have occurred",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });
    this.ponder_realtime_latency = new prometheus.Histogram({
      name: "ponder_realtime_latency",
      help: "Time elapsed between receiving a block and fully processing it",
      labelNames: ["network"] as const,
      buckets: httpRequestDurationMs,
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

    this.ponder_postgres_query_total = new prometheus.Counter({
      name: "ponder_postgres_query_total",
      help: "Total number of queries submitted to the database",
      labelNames: ["pool"] as const,
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

  resetIndexingMetrics() {
    this.start_timestamp = Date.now();
    this.rps = {};

    this.ponder_settings_info.reset();
    this.ponder_historical_start_timestamp_seconds.reset();
    this.ponder_historical_end_timestamp_seconds.reset();
    this.ponder_historical_total_indexing_seconds.reset();
    this.ponder_historical_cached_indexing_seconds.reset();
    this.ponder_historical_completed_indexing_seconds.reset();
    this.ponder_indexing_completed_events.reset();
    this.ponder_indexing_timestamp.reset();
    this.ponder_indexing_has_error.reset();
    this.ponder_indexing_function_duration.reset();
    this.ponder_indexing_abi_decoding_duration.reset();
    this.ponder_sync_block.reset();
    this.ponder_sync_is_realtime.reset();
    this.ponder_sync_is_complete.reset();
    this.ponder_historical_duration.reset();
    this.ponder_historical_total_blocks.reset();
    this.ponder_historical_cached_blocks.reset();
    this.ponder_historical_completed_blocks.reset();
    this.ponder_realtime_reorg_total.reset();
    this.ponder_rpc_request_duration.reset();
    this.ponder_rpc_request_lag.reset();

    // Note: These are used by both indexing and API services.
    this.ponder_database_method_duration.reset();
    this.ponder_database_method_error_total.reset();
    this.ponder_postgres_pool_connections?.reset();
    this.ponder_postgres_query_queue_size?.reset();
    this.ponder_postgres_query_total?.reset();
  }

  resetApiMetrics() {
    this.ponder_http_server_port.reset();
    this.ponder_http_server_active_requests.reset();
    this.ponder_http_server_request_duration_ms.reset();
    this.ponder_http_server_request_size_bytes.reset();
    this.ponder_http_server_response_size_bytes.reset();

    // TODO: Create a separate metric for API build errors,
    // or stop using metrics for the TUI error message.
    this.ponder_indexing_has_error.reset();
  }
}

export async function getSyncProgress(metrics: MetricsService): Promise<
  {
    networkName: string;
    block: number | undefined;
    // events: number;
    status: "historical" | "realtime" | "complete";
    progress: number;
    eta: number | undefined;
    rps: number;
  }[]
> {
  const syncDurationMetric = await metrics.ponder_historical_duration
    .get()
    .then((metrics) => metrics.values);
  const syncDurationSum: { [network: string]: number } = {};
  for (const m of syncDurationMetric) {
    if (m.metricName === "ponder_historical_duration_sum") {
      syncDurationSum[m.labels.network!] = m.value;
    }
  }

  const extractMetric = (
    metric: prometheus.MetricObjectWithValues<
      prometheus.MetricValue<"network">
    >,
    network: string,
  ) => {
    return metric.values.find((m) => m.labels.network === network)?.value;
  };

  const totalBlocksMetric = await metrics.ponder_historical_total_blocks.get();
  const cachedBlocksMetric =
    await metrics.ponder_historical_cached_blocks.get();
  const completedBlocksMetric =
    await metrics.ponder_historical_completed_blocks.get();
  const syncBlockMetric = await metrics.ponder_sync_block.get();
  const syncIsRealtimeMetrics = await metrics.ponder_sync_is_realtime.get();
  const syncIsCompleteMetrics = await metrics.ponder_sync_is_complete.get();

  const requestCount: { [network: string]: number } = {};
  const rpcRequestMetrics = await metrics.ponder_rpc_request_duration.get();
  for (const m of rpcRequestMetrics.values) {
    const network = m.labels.network!;
    if (m.metricName === "ponder_rpc_request_duration_count") {
      if (requestCount[network] === undefined) {
        requestCount[network] = 0;
      }
      requestCount[m.labels.network!]! += m.value;
    }
  }

  for (const [networkName, count] of Object.entries(requestCount)) {
    if (metrics.rps[networkName] === undefined) {
      metrics.rps[networkName] = [{ count, timestamp: Date.now() }];
    } else {
      metrics.rps[networkName]!.push({ count, timestamp: Date.now() });
    }

    if (metrics.rps[networkName]!.length > 100) {
      metrics.rps[networkName]!.shift();
    }
  }

  return totalBlocksMetric.values.map(({ value, labels }) => {
    const network = labels.network as string;
    const totalBlocks = value;
    const cachedBlocks = extractMetric(cachedBlocksMetric, network) ?? 0;
    const completedBlocks = extractMetric(completedBlocksMetric, network) ?? 0;
    const syncBlock = extractMetric(syncBlockMetric, network);
    const isRealtime = extractMetric(syncIsRealtimeMetrics, network);
    const isComplete = extractMetric(syncIsCompleteMetrics, network);

    const progress =
      totalBlocks === 0 ? 1 : (completedBlocks + cachedBlocks) / totalBlocks;
    const elapsed = syncDurationSum[network]!;
    const total = elapsed / (completedBlocks / (totalBlocks - cachedBlocks));
    // The ETA is low quality if we've completed only one or two blocks.
    const eta = completedBlocks >= 3 ? total - elapsed : undefined;

    const _length = metrics.rps[labels.network!]!.length;
    const _firstRps = metrics.rps[labels.network!]![0]!;
    const _lastRps = metrics.rps[labels.network!]![_length - 1]!;

    const requests = _lastRps.count - (_length > 1 ? _firstRps.count : 0);
    const seconds =
      _length === 1 ? 0.1 : (_lastRps.timestamp - _firstRps.timestamp) / 1_000;

    return {
      networkName: network,
      block: syncBlock,
      progress,
      status: isComplete ? "complete" : isRealtime ? "realtime" : "historical",
      eta,
      rps: requests / seconds,
    } as const;
  });
}

export async function getIndexingProgress(metrics: MetricsService) {
  const hasErrorMetric = (await metrics.ponder_indexing_has_error.get())
    .values[0]?.value;
  const hasError = hasErrorMetric === 1;

  const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
  const max = (x: number[]) => x.reduce((a, b) => Math.max(a, b), 0);

  const totalSeconds = await metrics.ponder_historical_total_indexing_seconds
    .get()
    .then(({ values }) => values.map(({ value }) => value))
    .then(sum);
  const cachedSeconds = await metrics.ponder_historical_cached_indexing_seconds
    .get()
    .then(({ values }) => values.map(({ value }) => value))
    .then(sum);
  const completedSeconds =
    await metrics.ponder_historical_completed_indexing_seconds
      .get()
      .then(({ values }) => values.map(({ value }) => value))
      .then(sum);
  const timestamp = await metrics.ponder_indexing_timestamp
    .get()
    .then(({ values }) => values.map(({ value }) => value))
    .then(max);

  const progress =
    timestamp === 0
      ? 0
      : totalSeconds === 0
        ? 1
        : (completedSeconds + cachedSeconds) / totalSeconds;

  const indexingCompletedEventsMetric = (
    await metrics.ponder_indexing_completed_events.get()
  ).values;
  const indexingFunctionDurationMetric = (
    await metrics.ponder_indexing_function_duration.get()
  ).values;

  const indexingDurationSum: Record<string, number> = {};
  const indexingDurationCount: Record<string, number> = {};
  for (const m of indexingFunctionDurationMetric) {
    if (m.metricName === "ponder_indexing_function_duration_sum")
      indexingDurationSum[m.labels.event!] = m.value;
    if (m.metricName === "ponder_indexing_function_duration_count")
      indexingDurationCount[m.labels.event!] = m.value;
  }

  const events = indexingCompletedEventsMetric.map((m) => {
    const eventName = truncate(m.labels.event as string);
    const count = m.value;

    const durationSum = indexingDurationSum[eventName] ?? 0;
    const durationCount = indexingDurationCount[eventName] ?? 0;
    const averageDuration =
      durationCount === 0 ? 0 : durationSum / durationCount;

    return { eventName, count, averageDuration };
  });

  const totalEvents = events.reduce((a, e) => a + e.count, 0);

  return {
    hasError,
    overall: {
      totalSeconds,
      cachedSeconds,
      completedSeconds,
      progress,
      totalEvents,
    },
    events,
  };
}

export async function getAppProgress(metrics: MetricsService): Promise<{
  mode: "historical" | "realtime" | undefined;
  progress: number;
  eta: number | undefined;
}> {
  const indexing = await getIndexingProgress(metrics);

  const remainingSeconds =
    indexing.overall.totalSeconds -
    (indexing.overall.completedSeconds + indexing.overall.cachedSeconds);
  const elapsedSeconds = (Date.now() - metrics.start_timestamp) / 1_000;

  const eta =
    indexing.overall.completedSeconds === 0
      ? 0
      : (elapsedSeconds / indexing.overall.completedSeconds) * remainingSeconds;

  return {
    mode: indexing.overall.progress === 1 ? "realtime" : "historical",
    progress: indexing.overall.progress,
    eta,
  };
}
