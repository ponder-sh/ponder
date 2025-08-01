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
  progressMetadata: {
    [chain: string]: {
      batches: {
        elapsedSeconds: number;
        completedSeconds: number;
      }[];
      previousTimestamp: number;
      previousCompletedSeconds: number;
      rate: number;
    };
  };

  rps: { [chain: string]: { count: number; timestamp: number }[] };

  ponder_version_info: prometheus.Gauge<
    "version" | "major" | "minor" | "patch"
  >;
  ponder_settings_info: prometheus.Gauge<"ordering" | "database" | "command">;

  ponder_historical_concurrency_group_duration: prometheus.Gauge<"group">;
  ponder_historical_extract_duration: prometheus.Gauge<"step">;
  ponder_historical_transform_duration: prometheus.Gauge<"step">;

  ponder_historical_start_timestamp_seconds: prometheus.Gauge;
  ponder_historical_end_timestamp_seconds: prometheus.Gauge;

  ponder_historical_total_indexing_seconds: prometheus.Gauge<"chain">;
  ponder_historical_cached_indexing_seconds: prometheus.Gauge<"chain">;
  ponder_historical_completed_indexing_seconds: prometheus.Gauge<"chain">;

  ponder_indexing_timestamp: prometheus.Gauge<"chain">;
  ponder_indexing_has_error: prometheus.Gauge<"chain">;

  ponder_indexing_completed_events: prometheus.Gauge<"event">;
  ponder_indexing_function_duration: prometheus.Histogram<"event">;
  ponder_indexing_cache_requests_total: prometheus.Counter<"table" | "type">;
  ponder_indexing_cache_query_duration: prometheus.Histogram<
    "table" | "method"
  >;
  ponder_indexing_rpc_action_duration: prometheus.Histogram<"action">;
  ponder_indexing_rpc_prefetch_total: prometheus.Counter<
    "chain" | "method" | "type"
  >;
  ponder_indexing_rpc_requests_total: prometheus.Counter<
    "chain" | "method" | "type"
  >;
  ponder_indexing_store_queries_total: prometheus.Counter<"table" | "method">;
  ponder_indexing_store_raw_sql_duration: prometheus.Histogram;

  ponder_sync_block: prometheus.Gauge<"chain">;
  ponder_sync_block_timestamp: prometheus.Gauge<"chain">;
  ponder_sync_is_realtime: prometheus.Gauge<"chain">;
  ponder_sync_is_complete: prometheus.Gauge<"chain">;

  ponder_historical_duration: prometheus.Histogram<"chain">;
  ponder_historical_total_blocks: prometheus.Gauge<"chain">;
  ponder_historical_cached_blocks: prometheus.Gauge<"chain">;
  ponder_historical_completed_blocks: prometheus.Gauge<"chain">;

  ponder_realtime_reorg_total: prometheus.Counter<"chain">;
  ponder_realtime_latency: prometheus.Histogram<"chain">;
  ponder_realtime_block_arrival_latency: prometheus.Histogram<"chain">;

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

  ponder_rpc_request_duration: prometheus.Histogram<"chain" | "method">;
  ponder_rpc_request_error_total: prometheus.Counter<"chain" | "method">;

  ponder_postgres_query_total: prometheus.Counter<"pool">;
  ponder_postgres_query_queue_size: prometheus.Gauge<"pool"> = null!;
  ponder_postgres_pool_connections: prometheus.Gauge<"pool" | "kind"> = null!;

  constructor() {
    this.registry = new prometheus.Registry();
    this.start_timestamp = Date.now();
    this.progressMetadata = {
      general: {
        batches: [{ elapsedSeconds: 0, completedSeconds: 0 }],
        previousTimestamp: Date.now(),
        previousCompletedSeconds: 0,
        rate: 0,
      },
    };
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

    this.ponder_historical_concurrency_group_duration = new prometheus.Gauge({
      name: "ponder_historical_concurrency_group_duration",
      help: "Duration of historical concurrency groups",
      labelNames: ["group"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_extract_duration = new prometheus.Gauge({
      name: "ponder_historical_extract_duration",
      help: "Duration of historical extract phase",
      labelNames: ["step"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_transform_duration = new prometheus.Gauge({
      name: "ponder_historical_transform_duration",
      help: "Duration of historical transform phase",
      labelNames: ["step"] as const,
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
      labelNames: ["chain"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_cached_indexing_seconds = new prometheus.Gauge({
      name: "ponder_historical_cached_indexing_seconds",
      help: "Number of seconds that have been cached",
      labelNames: ["chain"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_completed_indexing_seconds = new prometheus.Gauge({
      name: "ponder_historical_completed_indexing_seconds",
      help: "Number of seconds that have been completed",
      labelNames: ["chain"] as const,
      registers: [this.registry],
    });
    this.ponder_indexing_completed_events = new prometheus.Gauge({
      name: "ponder_indexing_completed_events",
      help: "Number of events that have been processed",
      labelNames: ["chain", "event"] as const,
      registers: [this.registry],
    });
    this.ponder_indexing_timestamp = new prometheus.Gauge({
      name: "ponder_indexing_timestamp",
      help: "Timestamp through which all events have been completed",
      labelNames: ["chain"] as const,
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
      labelNames: ["chain", "event"] as const,
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
    this.ponder_indexing_rpc_action_duration = new prometheus.Histogram({
      name: "ponder_indexing_rpc_action_duration",
      help: "Duration of RPC actions",
      labelNames: ["action"] as const,
      buckets: databaseQueryDurationMs,
      registers: [this.registry],
    });
    this.ponder_indexing_rpc_prefetch_total = new prometheus.Counter({
      name: "ponder_indexing_rpc_prefetch_total",
      help: "Number of RPC prefetches",
      labelNames: ["chain", "method", "type"] as const,
      registers: [this.registry],
    });
    this.ponder_indexing_rpc_requests_total = new prometheus.Counter({
      name: "ponder_indexing_rpc_requests_total",
      help: "Number of RPC requests",
      labelNames: ["chain", "method", "type"] as const,
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
      labelNames: ["chain"] as const,
      registers: [this.registry],
    });
    this.ponder_sync_block_timestamp = new prometheus.Gauge({
      name: "ponder_sync_block_timestamp",
      help: "Closest-to-tip synced block timestamp",
      labelNames: ["chain"] as const,
      registers: [this.registry],
    });
    this.ponder_sync_is_realtime = new prometheus.Gauge({
      name: "ponder_sync_is_realtime",
      help: "Boolean (0 or 1) indicating if the sync is realtime mode",
      labelNames: ["chain"] as const,
      registers: [this.registry],
    });
    this.ponder_sync_is_complete = new prometheus.Gauge({
      name: "ponder_sync_is_complete",
      help: "Boolean (0 or 1) indicating if the sync has synced all blocks",
      labelNames: ["chain"] as const,
      registers: [this.registry],
    });

    this.ponder_historical_duration = new prometheus.Histogram({
      name: "ponder_historical_duration",
      help: "Duration of historical sync execution",
      labelNames: ["chain"] as const,
      buckets: httpRequestDurationMs,
      registers: [this.registry],
    });
    this.ponder_historical_total_blocks = new prometheus.Gauge({
      name: "ponder_historical_total_blocks",
      help: "Number of blocks required for the historical sync",
      labelNames: ["chain"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_cached_blocks = new prometheus.Gauge({
      name: "ponder_historical_cached_blocks",
      help: "Number of blocks that were found in the cache for the historical sync",
      labelNames: ["chain"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_completed_blocks = new prometheus.Gauge({
      name: "ponder_historical_completed_blocks",
      help: "Number of blocks that have been processed for the historical sync",
      labelNames: ["chain", "source", "type"] as const,
      registers: [this.registry],
    });

    this.ponder_realtime_reorg_total = new prometheus.Counter({
      name: "ponder_realtime_reorg_total",
      help: "Count of how many re-orgs have occurred",
      labelNames: ["chain"] as const,
      registers: [this.registry],
    });
    this.ponder_realtime_latency = new prometheus.Histogram({
      name: "ponder_realtime_latency",
      help: "Time elapsed between receiving a block and fully processing it",
      labelNames: ["chain"] as const,
      buckets: httpRequestDurationMs,
      registers: [this.registry],
    });
    this.ponder_realtime_block_arrival_latency = new prometheus.Histogram({
      name: "ponder_realtime_block_arrival_latency",
      help: "Time elapsed between mining a block and being received by the realtime sync",
      labelNames: ["chain"] as const,
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
      help: "Duration of successful RPC requests",
      labelNames: ["chain", "method"] as const,
      buckets: httpRequestDurationMs,
      registers: [this.registry],
    });

    this.ponder_rpc_request_error_total = new prometheus.Counter({
      name: "ponder_rpc_request_error_total",
      help: "Total count of failed RPC requests",
      labelNames: ["chain", "method"] as const,
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
    this.progressMetadata = {
      general: {
        batches: [{ elapsedSeconds: 0, completedSeconds: 0 }],
        previousTimestamp: Date.now(),
        previousCompletedSeconds: 0,
        rate: 0,
      },
    };

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
    this.ponder_sync_block.reset();
    this.ponder_sync_is_realtime.reset();
    this.ponder_sync_is_complete.reset();
    this.ponder_historical_duration.reset();
    this.ponder_historical_total_blocks.reset();
    this.ponder_historical_cached_blocks.reset();
    this.ponder_historical_completed_blocks.reset();
    this.ponder_realtime_reorg_total.reset();
    this.ponder_rpc_request_duration.reset();
    this.ponder_rpc_request_error_total.reset();

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

const extractMetric = (
  metric: prometheus.MetricObjectWithValues<prometheus.MetricValue<"chain">>,
  chain: string,
) => {
  return metric.values.find((m) => m.labels.chain === chain)?.value;
};

export async function getSyncProgress(metrics: MetricsService): Promise<
  {
    chainName: string;
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
  const syncDurationSum: { [chain: string]: number } = {};
  for (const m of syncDurationMetric) {
    if (m.metricName === "ponder_historical_duration_sum") {
      syncDurationSum[m.labels.chain!] = m.value;
    }
  }

  const totalBlocksMetric = await metrics.ponder_historical_total_blocks.get();
  const cachedBlocksMetric =
    await metrics.ponder_historical_cached_blocks.get();
  const completedBlocksMetric =
    await metrics.ponder_historical_completed_blocks.get();
  const syncBlockMetric = await metrics.ponder_sync_block.get();
  const syncIsRealtimeMetrics = await metrics.ponder_sync_is_realtime.get();
  const syncIsCompleteMetrics = await metrics.ponder_sync_is_complete.get();

  const requestCount: { [chain: string]: number } = {};
  const rpcRequestMetrics = await metrics.ponder_rpc_request_duration.get();
  for (const m of rpcRequestMetrics.values) {
    const chain = m.labels.chain!;
    if (m.metricName === "ponder_rpc_request_duration_count") {
      if (requestCount[chain] === undefined) {
        requestCount[chain] = 0;
      }
      requestCount[m.labels.chain!]! += m.value;
    }
  }

  for (const [chainName, count] of Object.entries(requestCount)) {
    if (metrics.rps[chainName] === undefined) {
      metrics.rps[chainName] = [{ count, timestamp: Date.now() }];
    } else {
      metrics.rps[chainName]!.push({ count, timestamp: Date.now() });
    }

    if (metrics.rps[chainName]!.length > 100) {
      metrics.rps[chainName]!.shift();
    }
  }

  return totalBlocksMetric.values.map(({ value, labels }) => {
    const chain = labels.chain as string;
    const totalBlocks = value;
    const cachedBlocks = extractMetric(cachedBlocksMetric, chain) ?? 0;
    const completedBlocks = extractMetric(completedBlocksMetric, chain) ?? 0;
    const syncBlock = extractMetric(syncBlockMetric, chain);
    const isRealtime = extractMetric(syncIsRealtimeMetrics, chain);
    const isComplete = extractMetric(syncIsCompleteMetrics, chain);

    const progress =
      totalBlocks === 0 ? 1 : (completedBlocks + cachedBlocks) / totalBlocks;
    const elapsed = syncDurationSum[chain]!;
    const total = elapsed / (completedBlocks / (totalBlocks - cachedBlocks));
    // The ETA is low quality if we've completed only one or two blocks.
    const eta = completedBlocks >= 3 ? total - elapsed : undefined;

    const _length = metrics.rps[labels.chain!]!.length;
    const _firstRps = metrics.rps[labels.chain!]![0]!;
    const _lastRps = metrics.rps[labels.chain!]![_length - 1]!;

    const requests = _lastRps.count - (_length > 1 ? _firstRps.count : 0);
    const seconds =
      _length === 1 ? 0.1 : (_lastRps.timestamp - _firstRps.timestamp) / 1_000;

    return {
      chainName: chain,
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
    const count = m.value;

    const durationSum = indexingDurationSum[m.labels.event as string] ?? 0;
    const durationCount = indexingDurationCount[m.labels.event as string] ?? 0;
    const averageDuration =
      durationCount === 0 ? 0 : durationSum / durationCount;

    const eventName = truncate(m.labels.event as string);
    return { eventName, count, averageDuration };
  });

  return {
    hasError,
    events,
  };
}

export async function getAppProgress(metrics: MetricsService): Promise<{
  mode: "historical" | "realtime" | undefined;
  progress: number | undefined;
  eta: number | undefined;
}> {
  const totalSecondsMetric =
    await metrics.ponder_historical_total_indexing_seconds.get();
  const cachedSecondsMetric =
    await metrics.ponder_historical_cached_indexing_seconds.get();
  const completedSecondsMetric =
    await metrics.ponder_historical_completed_indexing_seconds.get();
  const timestampMetric = await metrics.ponder_indexing_timestamp.get();

  const ordering: "multichain" | "omnichain" | undefined =
    await metrics.ponder_settings_info
      .get()
      .then((metric) => metric.values[0]?.labels.ordering as any);
  if (ordering === undefined) {
    return {
      mode: "historical",
      progress: undefined,
      eta: undefined,
    };
  } else if (ordering === "multichain") {
    const perChainAppProgress: Awaited<ReturnType<typeof getAppProgress>>[] =
      [];

    for (const chainName of totalSecondsMetric.values.map(
      ({ labels }) => labels.chain as string,
    )) {
      const totalSeconds = extractMetric(totalSecondsMetric, chainName);
      const cachedSeconds = extractMetric(cachedSecondsMetric, chainName);
      const completedSeconds = extractMetric(completedSecondsMetric, chainName);
      const timestamp = extractMetric(timestampMetric, chainName);

      if (
        totalSeconds === undefined ||
        cachedSeconds === undefined ||
        completedSeconds === undefined ||
        timestamp === undefined
      ) {
        continue;
      }

      const progress =
        timestamp === 0
          ? 0
          : totalSeconds === 0
            ? 1
            : (completedSeconds + cachedSeconds) / totalSeconds;

      if (!metrics.progressMetadata[chainName]) {
        metrics.progressMetadata[chainName] = {
          batches: [{ elapsedSeconds: 0, completedSeconds: 0 }],
          previousTimestamp: Date.now(),
          previousCompletedSeconds: 0,
          rate: 0,
        };
      }

      const eta: number | undefined = calculateEta(
        metrics.progressMetadata[chainName]!,
        totalSeconds,
        cachedSeconds,
        completedSeconds,
      );
      perChainAppProgress.push({
        mode: progress === 1 ? "realtime" : "historical",
        progress,
        eta,
      });
    }

    return perChainAppProgress.reduce(
      (prev, curr) => ({
        mode: curr.mode === "historical" ? curr.mode : prev.mode,
        progress:
          prev.progress === undefined || curr.progress === undefined
            ? undefined
            : Math.min(prev.progress, curr.progress),
        eta:
          curr.progress === 1
            ? prev.eta
            : prev.eta === undefined || curr.eta === undefined
              ? undefined
              : Math.max(prev.eta, curr.eta),
      }),
      {
        mode: "realtime",
        progress: 1,
        eta: 0,
      },
    ) as any;
  } else {
    const totalSeconds = totalSecondsMetric.values
      .map(({ value }) => value)
      .reduce((prev, curr) => prev + curr, 0);
    const cachedSeconds = cachedSecondsMetric.values
      .map(({ value }) => value)
      .reduce((prev, curr) => prev + curr, 0);
    const completedSeconds = completedSecondsMetric.values
      .map(({ value }) => value)
      .reduce((prev, curr) => prev + curr, 0);
    const timestamp = timestampMetric.values
      .map(({ value }) => value)
      .reduce((prev, curr) => Math.max(prev, curr), 0);

    const progress =
      timestamp === 0
        ? 0
        : totalSeconds === 0
          ? 1
          : (completedSeconds + cachedSeconds) / totalSeconds;

    return {
      mode: progress === 1 ? "realtime" : "historical",
      progress: progress,
      eta: calculateEta(
        metrics.progressMetadata.general!,
        totalSeconds,
        cachedSeconds,
        completedSeconds,
      ),
    };
  }
}

function calculateEta(
  progressMetadata: {
    batches: {
      elapsedSeconds: number;
      completedSeconds: number;
    }[];
    previousTimestamp: number;
    previousCompletedSeconds: number;
    rate: number;
  },
  totalSeconds: number,
  cachedSeconds: number,
  completedSeconds: number,
) {
  const remainingSeconds = Math.max(
    totalSeconds - (completedSeconds + cachedSeconds),
    0,
  );

  let eta: number | undefined = undefined;

  if (completedSeconds > 0) {
    const currentTimestamp = Date.now();

    progressMetadata.batches.at(-1)!.elapsedSeconds =
      Math.max(currentTimestamp - progressMetadata.previousTimestamp, 0) /
      1_000;
    progressMetadata.batches.at(-1)!.completedSeconds = Math.max(
      completedSeconds - progressMetadata.previousCompletedSeconds,
      0,
    );

    if (
      currentTimestamp - progressMetadata.previousTimestamp > 5_000 &&
      progressMetadata.batches.at(-1)!.completedSeconds > 0
    ) {
      progressMetadata.batches.push({
        elapsedSeconds: 0,
        completedSeconds: 0,
      });

      if (progressMetadata.batches.length > 10) {
        progressMetadata.batches.shift();
      }

      progressMetadata.previousCompletedSeconds = completedSeconds;
      progressMetadata.previousTimestamp = currentTimestamp;

      const averages: number[] = [];
      let count = 0;

      // Note: Calculate ETA only after at least 3 batches were collected for stable eta.
      if (progressMetadata.batches.length >= 3) {
        for (let i = 0; i < progressMetadata.batches.length - 1; ++i) {
          const batch = progressMetadata.batches[i]!;
          if (batch.completedSeconds === 0) continue;
          const multiplier = 1 / 1.5 ** (9 - i);
          averages.push(
            (multiplier * batch.elapsedSeconds) / batch.completedSeconds,
          );
          count += multiplier;
        }

        progressMetadata.rate =
          count === 0
            ? 0
            : averages.reduce((prev, curr) => prev + curr, 0) / count;
      }
    }

    if (progressMetadata.batches.length >= 3) {
      eta = progressMetadata.rate * remainingSeconds;
    }
  }

  return eta;
}
