import { type Worker, parentPort } from "node:worker_threads";
import {
  type PromiseWithResolvers,
  promiseWithResolvers,
} from "@/utils/promiseWithResolvers.js";
import { truncate } from "@/utils/truncate.js";
import { getTableName, isTable } from "drizzle-orm";
import prometheus from "prom-client";
import type { IndexingBuild, PreBuild, SchemaBuild } from "./types.js";

const sometimesIODurationMs = [
  0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100, 500, 1_000, 5_000,
  10_000, 50_000, 100_000,
];

const alwaysIODurationMs = [
  1, 5, 10, 50, 100, 500, 1_000, 5_000, 10_000, 50_000, 100_000, 500_000,
];

const httpRequestSizeBytes = [
  10, 100, 1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000,
  10_000_000,
];

const GET_METRICS_REQ = "prom-client:getMetricsReq";
const GET_METRICS_RES = "prom-client:getMetricsRes";

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

  hasError: boolean;
  port: number | undefined;
  rps: { [chain: string]: { count: number; timestamp: number }[] };

  ponder_version_info: prometheus.Gauge<
    "version" | "major" | "minor" | "patch"
  >;
  ponder_settings_info: prometheus.Gauge<"ordering" | "database" | "command">;

  ponder_historical_concurrency_group_duration: prometheus.Gauge<"group">;
  ponder_historical_extract_duration: prometheus.Gauge<"step">;
  ponder_historical_transform_duration: prometheus.Gauge<"step">;

  ponder_historical_start_timestamp_seconds: prometheus.Gauge<"chain">;
  ponder_historical_end_timestamp_seconds: prometheus.Gauge<"chain">;

  ponder_historical_total_indexing_seconds: prometheus.Gauge<"chain">;
  ponder_historical_cached_indexing_seconds: prometheus.Gauge<"chain">;
  ponder_historical_completed_indexing_seconds: prometheus.Gauge<"chain">;

  ponder_indexing_timestamp: prometheus.Gauge<"chain">;

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

  ponder_historical_total_blocks: prometheus.Gauge<"chain">;
  ponder_historical_cached_blocks: prometheus.Gauge<"chain">;
  ponder_historical_completed_blocks: prometheus.Gauge<"chain">;

  ponder_realtime_reorg_total: prometheus.Counter<"chain">;
  ponder_realtime_latency: prometheus.Histogram<"chain">;
  ponder_realtime_block_arrival_latency: prometheus.Histogram<"chain">;

  ponder_database_method_duration: prometheus.Histogram<"service" | "method">;
  ponder_database_method_error_total: prometheus.Counter<"service" | "method">;

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
    this.port = undefined!;
    this.hasError = false;
    this.rps = {};

    this.ponder_version_info = new prometheus.Gauge({
      name: "ponder_version_info",
      help: "Ponder version information",
      labelNames: ["version", "major", "minor", "patch"] as const,
      registers: [this.registry],
      aggregator: "first",
    });
    this.ponder_settings_info = new prometheus.Gauge({
      name: "ponder_settings_info",
      help: "Ponder settings information",
      labelNames: ["ordering", "database", "command"] as const,
      registers: [this.registry],
      aggregator: "first",
    });

    this.ponder_historical_concurrency_group_duration = new prometheus.Gauge({
      name: "ponder_historical_concurrency_group_duration",
      help: "Duration of historical concurrency groups",
      labelNames: ["group"] as const,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_historical_extract_duration = new prometheus.Gauge({
      name: "ponder_historical_extract_duration",
      help: "Duration of historical extract phase",
      labelNames: ["step"] as const,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_historical_transform_duration = new prometheus.Gauge({
      name: "ponder_historical_transform_duration",
      help: "Duration of historical transform phase",
      labelNames: ["step"] as const,
      registers: [this.registry],
      aggregator: "sum",
    });

    this.ponder_historical_start_timestamp_seconds = new prometheus.Gauge({
      name: "ponder_historical_start_timestamp_seconds",
      help: "Timestamp at which historical indexing started",
      labelNames: ["chain"] as const,
      registers: [this.registry],
      aggregator: "min",
    });
    this.ponder_historical_end_timestamp_seconds = new prometheus.Gauge({
      name: "ponder_historical_end_timestamp_seconds",
      help: "Timestamp at which historical indexing ended",
      labelNames: ["chain"] as const,
      registers: [this.registry],
      aggregator: "max",
    });

    this.ponder_historical_total_indexing_seconds = new prometheus.Gauge({
      name: "ponder_historical_total_indexing_seconds",
      help: "Total number of seconds that are required",
      labelNames: ["chain"] as const,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_historical_cached_indexing_seconds = new prometheus.Gauge({
      name: "ponder_historical_cached_indexing_seconds",
      help: "Number of seconds that have been cached",
      labelNames: ["chain"] as const,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_historical_completed_indexing_seconds = new prometheus.Gauge({
      name: "ponder_historical_completed_indexing_seconds",
      help: "Number of seconds that have been completed",
      labelNames: ["chain"] as const,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_indexing_completed_events = new prometheus.Gauge({
      name: "ponder_indexing_completed_events",
      help: "Number of events that have been processed",
      labelNames: ["chain", "event"] as const,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_indexing_timestamp = new prometheus.Gauge({
      name: "ponder_indexing_timestamp",
      help: "Timestamp through which all events have been completed",
      labelNames: ["chain"] as const,
      registers: [this.registry],
      aggregator: "first",
    });
    this.ponder_indexing_function_duration = new prometheus.Histogram({
      name: "ponder_indexing_function_duration",
      help: "Duration of indexing function execution",
      labelNames: ["chain", "event"] as const,
      buckets: sometimesIODurationMs,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_indexing_cache_query_duration = new prometheus.Histogram({
      name: "ponder_indexing_cache_query_duration",
      help: "Duration of cache operations",
      labelNames: ["table", "method"] as const,
      buckets: alwaysIODurationMs,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_indexing_rpc_action_duration = new prometheus.Histogram({
      name: "ponder_indexing_rpc_action_duration",
      help: "Duration of RPC actions",
      labelNames: ["action"] as const,
      buckets: sometimesIODurationMs,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_indexing_rpc_prefetch_total = new prometheus.Counter({
      name: "ponder_indexing_rpc_prefetch_total",
      help: "Number of RPC prefetches",
      labelNames: ["chain", "method", "type"] as const,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_indexing_rpc_requests_total = new prometheus.Counter({
      name: "ponder_indexing_rpc_requests_total",
      help: "Number of RPC requests",
      labelNames: ["chain", "method", "type"] as const,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_indexing_cache_requests_total = new prometheus.Counter({
      name: "ponder_indexing_cache_requests_total",
      help: "Number of cache accesses",
      labelNames: ["table", "type"] as const,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_indexing_store_queries_total = new prometheus.Counter({
      name: "ponder_indexing_store_queries_total",
      help: "Number of indexing store operations",
      labelNames: ["table", "method"] as const,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_indexing_store_raw_sql_duration = new prometheus.Histogram({
      name: "ponder_indexing_store_raw_sql_duration",
      help: "Duration of raw SQL store operations",
      buckets: alwaysIODurationMs,
      registers: [this.registry],
      aggregator: "sum",
    });

    this.ponder_sync_block = new prometheus.Gauge({
      name: "ponder_sync_block",
      help: "Closest-to-tip synced block number",
      labelNames: ["chain"] as const,
      registers: [this.registry],
      aggregator: "max",
    });
    this.ponder_sync_block_timestamp = new prometheus.Gauge({
      name: "ponder_sync_block_timestamp",
      help: "Closest-to-tip synced block timestamp",
      labelNames: ["chain"] as const,
      registers: [this.registry],
      aggregator: "max",
    });
    this.ponder_sync_is_realtime = new prometheus.Gauge({
      name: "ponder_sync_is_realtime",
      help: "Boolean (0 or 1) indicating if the sync is realtime mode",
      labelNames: ["chain"] as const,
      registers: [this.registry],
      aggregator: "max",
    });
    this.ponder_sync_is_complete = new prometheus.Gauge({
      name: "ponder_sync_is_complete",
      help: "Boolean (0 or 1) indicating if the sync has synced all blocks",
      labelNames: ["chain"] as const,
      registers: [this.registry],
      aggregator: "max",
    });

    this.ponder_historical_total_blocks = new prometheus.Gauge({
      name: "ponder_historical_total_blocks",
      help: "Number of blocks required for the historical sync",
      labelNames: ["chain"] as const,
      registers: [this.registry],
      aggregator: "max",
    });
    this.ponder_historical_cached_blocks = new prometheus.Gauge({
      name: "ponder_historical_cached_blocks",
      help: "Number of blocks that were found in the cache for the historical sync",
      labelNames: ["chain"] as const,
      registers: [this.registry],
      aggregator: "max",
    });
    this.ponder_historical_completed_blocks = new prometheus.Gauge({
      name: "ponder_historical_completed_blocks",
      help: "Number of blocks that have been processed for the historical sync",
      labelNames: ["chain", "source", "type"] as const,
      registers: [this.registry],
      aggregator: "max",
    });

    this.ponder_realtime_reorg_total = new prometheus.Counter({
      name: "ponder_realtime_reorg_total",
      help: "Count of how many re-orgs have occurred",
      labelNames: ["chain"] as const,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_realtime_latency = new prometheus.Histogram({
      name: "ponder_realtime_latency",
      help: "Time elapsed between receiving a block and fully processing it",
      labelNames: ["chain"] as const,
      buckets: [
        1, 5, 10, 50, 100, 500, 1_000, 5_000, 10_000, 50_000, 100_000, 500_000,
        1_000_000,
      ],
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_realtime_block_arrival_latency = new prometheus.Histogram({
      name: "ponder_realtime_block_arrival_latency",
      help: "Time elapsed between mining a block and being received by the realtime sync",
      labelNames: ["chain"] as const,
      buckets: [
        1, 5, 10, 50, 100, 500, 1_000, 5_000, 10_000, 50_000, 100_000, 500_000,
        1_000_000,
      ],
      registers: [this.registry],
      aggregator: "sum",
    });

    this.ponder_database_method_duration = new prometheus.Histogram({
      name: "ponder_database_method_duration",
      help: "Duration of database operations",
      labelNames: ["service", "method"] as const,
      buckets: alwaysIODurationMs,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_database_method_error_total = new prometheus.Counter({
      name: "ponder_database_method_error_total",
      help: "Total number of errors encountered during database operations",
      labelNames: ["service", "method"] as const,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_http_server_active_requests = new prometheus.Gauge({
      name: "ponder_http_server_active_requests",
      help: "Number of active HTTP server requests",
      labelNames: ["method", "path"] as const,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_http_server_request_duration_ms = new prometheus.Histogram({
      name: "ponder_http_server_request_duration_ms",
      help: "Duration of HTTP responses served the server",
      labelNames: ["method", "path", "status"] as const,
      buckets: alwaysIODurationMs,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_http_server_request_size_bytes = new prometheus.Histogram({
      name: "ponder_http_server_request_size_bytes",
      help: "Size of HTTP requests received by the server",
      labelNames: ["method", "path", "status"] as const,
      buckets: httpRequestSizeBytes,
      registers: [this.registry],
      aggregator: "sum",
    });
    this.ponder_http_server_response_size_bytes = new prometheus.Histogram({
      name: "ponder_http_server_response_size_bytes",
      help: "Size of HTTP responses served the server",
      labelNames: ["method", "path", "status"] as const,
      buckets: httpRequestSizeBytes,
      registers: [this.registry],
      aggregator: "sum",
    });

    this.ponder_rpc_request_duration = new prometheus.Histogram({
      name: "ponder_rpc_request_duration",
      help: "Duration of successful RPC requests",
      labelNames: ["chain", "method"] as const,
      buckets: alwaysIODurationMs,
      registers: [this.registry],
      aggregator: "sum",
    });

    this.ponder_rpc_request_error_total = new prometheus.Counter({
      name: "ponder_rpc_request_error_total",
      help: "Total count of failed RPC requests",
      labelNames: ["chain", "method"] as const,
      registers: [this.registry],
      aggregator: "sum",
    });

    this.ponder_postgres_query_total = new prometheus.Counter({
      name: "ponder_postgres_query_total",
      help: "Total number of queries submitted to the database",
      labelNames: ["pool"] as const,
      registers: [this.registry],
      aggregator: "sum",
    });

    prometheus.collectDefaultMetrics({
      register: this.registry,
      eventLoopMonitoringPrecision: 1,
      gcDurationBuckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
    });
  }

  /**
   * Get string representation for all metrics.
   * @returns Metrics encoded using Prometheus v0.0.4 format.
   */
  getMetrics() {
    return this.registry.metrics();
  }

  async getRegistry() {
    return this.registry;
  }

  initializeIndexingMetrics({
    indexingBuild,
    schemaBuild,
  }: {
    indexingBuild: Pick<IndexingBuild, "indexingFunctions">;
    schemaBuild: SchemaBuild;
  }) {
    const tables = Object.values(schemaBuild.schema).filter(isTable);

    for (const { name: eventName } of indexingBuild.indexingFunctions) {
      this.ponder_indexing_completed_events.inc({ event: eventName }, 0);
    }

    for (const table of tables) {
      for (const type of ["complete", "hit", "miss"]) {
        this.ponder_indexing_cache_requests_total.inc(
          { table: getTableName(table), type },
          0,
        );
      }

      for (const method of ["find", "insert", "update", "delete"]) {
        this.ponder_indexing_store_queries_total.inc(
          { table: getTableName(table), method },
          0,
        );
      }
    }
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
    this.hasError = false;

    this.ponder_settings_info.reset();
    this.ponder_historical_start_timestamp_seconds.reset();
    this.ponder_historical_end_timestamp_seconds.reset();
    this.ponder_historical_total_indexing_seconds.reset();
    this.ponder_historical_cached_indexing_seconds.reset();
    this.ponder_historical_completed_indexing_seconds.reset();
    this.ponder_indexing_completed_events.reset();
    this.ponder_indexing_timestamp.reset();
    this.ponder_indexing_function_duration.reset();
    this.ponder_sync_block.reset();
    this.ponder_sync_is_realtime.reset();
    this.ponder_sync_is_complete.reset();
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
    this.port = undefined;
    // TODO: Create a separate metric for API build errors,
    // or stop using metrics for the TUI error message.
    this.hasError = false;
    this.ponder_http_server_active_requests.reset();
    this.ponder_http_server_request_duration_ms.reset();
    this.ponder_http_server_request_size_bytes.reset();
    this.ponder_http_server_response_size_bytes.reset();
  }
}

type MetricsAggregationRequest = {
  type: typeof GET_METRICS_REQ;
  requestId: number;
};
type MetricsAggregationResponse = {
  type: typeof GET_METRICS_RES;
  requestId: number;
  error?: string;
  metrics: prometheus.MetricObjectWithValues<prometheus.MetricValue<string>>[];
};

export class AggregateMetricsService extends MetricsService {
  workers: Worker[];
  requests: Map<
    number,
    {
      responses: prometheus.MetricObjectWithValues<
        prometheus.MetricValue<string>
      >[][];
      workerIds: number[];
      pending: number;
      pwr: PromiseWithResolvers<void>;
    }
  >;
  requestId: number;
  mainThreadMetrics: MetricsService;

  constructor(mainThreadMetrics: MetricsService, workers: Worker[]) {
    super();

    this.mainThreadMetrics = mainThreadMetrics;
    this.workers = workers;
    this.requests = new Map();
    this.requestId = 0;

    for (const worker of workers) {
      worker.on("message", (message: MetricsAggregationResponse) => {
        if (message.type === GET_METRICS_RES) {
          const request = this.requests.get(message.requestId);

          if (request === undefined) return;

          if (message.error) {
            request.pwr.reject(new Error(message.error));
            return;
          }

          request.responses.push(message.metrics);
          request.workerIds.push(worker.threadId);
          request.pending--;
          if (request.pending === 0) {
            request.pwr.resolve();
          }
        }
      });
    }
  }

  override async getMetrics() {
    const requestId = this.requestId++;
    const pwr = promiseWithResolvers<void>();

    this.requests.set(requestId, {
      responses: [],
      workerIds: [],
      pending: this.workers.length,
      pwr,
    });

    for (const worker of this.workers) {
      worker.postMessage({
        type: GET_METRICS_REQ,
        requestId,
      } satisfies MetricsAggregationRequest);
    }

    await pwr.promise;

    const request = this.requests.get(requestId)!;
    this.requests.delete(requestId);

    // Sort response by worker id for consistent metrics
    const responseIndexSort = new Array(this.workers.length)
      .fill(0)
      .map((_, index) => index)
      .sort((a, b) => request.workerIds[a]! - request.workerIds[b]!);

    return prometheus.AggregatorRegistry.aggregate([
      ...responseIndexSort.map((index) => request.responses[index]!),
      await this.registry.getMetricsAsJSON(),
      await this.mainThreadMetrics.registry.getMetricsAsJSON(),
    ]).metrics();
  }

  override async getRegistry() {
    const requestId = this.requestId++;
    const pwr = promiseWithResolvers<void>();

    this.requests.set(requestId, {
      responses: [],
      workerIds: [],
      pending: this.workers.length,
      pwr,
    });

    for (const worker of this.workers) {
      worker.postMessage({
        type: GET_METRICS_REQ,
        requestId,
      } satisfies MetricsAggregationRequest);
    }

    await pwr.promise;

    const request = this.requests.get(requestId)!;
    this.requests.delete(requestId);

    // Sort response by worker id for consistent metrics
    const responseIndexSort = new Array(this.workers.length)
      .fill(0)
      .map((_, index) => index)
      .sort((a, b) => request.workerIds[a]! - request.workerIds[b]!);

    return prometheus.AggregatorRegistry.aggregate([
      ...responseIndexSort.map((index) => request.responses[index]!),
      await this.registry.getMetricsAsJSON(),
      await this.mainThreadMetrics.registry.getMetricsAsJSON(),
    ]) as prometheus.Registry;
  }

  // Note: `resetIndexingMetrics` and `resetApiMetrics` are never called with `AggregateMetricsService`.
}

export class IsolatedMetricsService extends MetricsService {
  constructor() {
    super();

    if (parentPort) {
      parentPort.on("message", (message: MetricsAggregationRequest) => {
        if (message.type === GET_METRICS_REQ) {
          this.registry
            .getMetricsAsJSON()
            .then((metrics) => {
              parentPort!.postMessage({
                type: GET_METRICS_RES,
                requestId: message.requestId,
                metrics,
              });
            })
            .catch((error) => {
              parentPort!.postMessage({
                type: GET_METRICS_RES,
                requestId: message.requestId,
                error: error.message,
              });
            });
        }
      });
    }
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
    status: "backfill" | "live" | "complete";
    progress: number;
    rps: number;
  }[]
> {
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
      status: isComplete ? "complete" : isRealtime ? "live" : "backfill",
      rps: requests / seconds,
    } as const;
  });
}

export async function getIndexingProgress(metrics: MetricsService) {
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
    hasError: metrics.hasError,
    events,
  };
}

export async function getAppProgress(metrics: MetricsService): Promise<{
  mode: "backfill" | "live" | undefined;
  progress: number | undefined;
  eta: number | undefined;
}> {
  // Note: `getRegistry` must be used because this function is used with "experimental_isolated" ordering.
  const registry = await metrics.getRegistry();

  const totalSecondsMetric = await registry
    .getSingleMetric("ponder_historical_total_indexing_seconds")!
    .get();
  const cachedSecondsMetric = await registry
    .getSingleMetric("ponder_historical_cached_indexing_seconds")!
    .get();
  const completedSecondsMetric = await registry
    .getSingleMetric("ponder_historical_completed_indexing_seconds")!
    .get();
  const timestampMetric = await registry
    .getSingleMetric("ponder_indexing_timestamp")!
    .get();

  const settingsMetric = await registry
    .getSingleMetric("ponder_settings_info")!
    .get();
  const ordering: PreBuild["ordering"] | undefined = settingsMetric?.values[0]
    ?.labels.ordering as any;

  switch (ordering) {
    case undefined:
      return {
        mode: "backfill",
        progress: undefined,
        eta: undefined,
      };
    case "omnichain": {
      const totalSeconds = totalSecondsMetric?.values
        .map(({ value }) => value)
        .reduce((prev, curr) => prev + curr, 0);
      const cachedSeconds = cachedSecondsMetric?.values
        .map(({ value }) => value)
        .reduce((prev, curr) => prev + curr, 0);
      const completedSeconds = completedSecondsMetric?.values
        .map(({ value }) => value)
        .reduce((prev, curr) => prev + curr, 0);
      const timestamp = timestampMetric?.values
        .map(({ value }) => value)
        .reduce((prev, curr) => Math.max(prev, curr), 0);

      const progress =
        timestamp === 0
          ? 0
          : totalSeconds === 0
            ? 1
            : (completedSeconds + cachedSeconds) / totalSeconds;

      return {
        mode: progress === 1 ? "live" : "backfill",
        progress: progress,
        eta: calculateEta(
          metrics.progressMetadata.general!,
          totalSeconds,
          cachedSeconds,
          completedSeconds,
        ),
      };
    }
    case "multichain":
    case "experimental_isolated": {
      const perChainAppProgress: Awaited<ReturnType<typeof getAppProgress>>[] =
        [];

      for (const chainName of totalSecondsMetric?.values.map(
        ({ labels }) => labels.chain as string,
      ) ?? []) {
        const totalSeconds = extractMetric(totalSecondsMetric, chainName);
        const cachedSeconds = extractMetric(cachedSecondsMetric, chainName);
        const completedSeconds = extractMetric(
          completedSecondsMetric,
          chainName,
        );
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
          mode: progress === 1 ? "live" : "backfill",
          progress,
          eta,
        });
      }

      return perChainAppProgress.reduce(
        (prev, curr) => ({
          mode: curr.mode === "backfill" ? curr.mode : prev.mode,
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
          mode: "live",
          progress: 1,
          eta: 0,
        },
      );
    }
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
