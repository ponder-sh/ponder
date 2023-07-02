import prometheus from "prom-client";

const httpRequestBucketsInMs = [
  5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 250, 300, 350, 400, 450,
  500, 750, 1_000, 2_000, 10_000,
];

export class MetricsService {
  private registry: prometheus.Registry;

  ponder_historical_scheduled_tasks: prometheus.Counter<"network" | "kind">;
  ponder_historical_completed_tasks: prometheus.Counter<
    "network" | "kind" | "status"
  >;
  ponder_historical_total_blocks: prometheus.Gauge<"network" | "logFilter">;
  ponder_historical_cached_blocks: prometheus.Gauge<"network" | "logFilter">;
  ponder_historical_completed_blocks: prometheus.Gauge<"network" | "logFilter">;

  ponder_historical_rpc_request_duration: prometheus.Histogram<
    "network" | "method"
  >;
  ponder_realtime_latest_block_number: prometheus.Gauge<"network">;
  ponder_realtime_latest_block_timestamp: prometheus.Gauge<"network">;
  ponder_realtime_rpc_request_duration: prometheus.Histogram<
    "network" | "method"
  >;

  constructor() {
    this.registry = new prometheus.Registry();

    // Register default metric collection.
    prometheus.collectDefaultMetrics({
      register: this.registry,
      prefix: "ponder_default_",
    });

    // Historical sync metrics
    this.ponder_historical_scheduled_tasks = new prometheus.Counter({
      name: "ponder_historical_scheduled_tasks",
      help: "Number of historical sync tasks that have been scheduled",
      labelNames: ["network", "kind"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_completed_tasks = new prometheus.Counter({
      name: "ponder_historical_completed_tasks",
      help: "Number of historical sync tasks that have been processed",
      labelNames: ["network", "kind", "status"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_total_blocks = new prometheus.Gauge({
      name: "ponder_historical_total_blocks",
      help: "Number of blocks required for the historical sync",
      labelNames: ["network", "logFilter"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_cached_blocks = new prometheus.Gauge({
      name: "ponder_historical_cached_blocks",
      help: "Number of blocks that were found in the cache for the historical sync",
      labelNames: ["network", "logFilter"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_completed_blocks = new prometheus.Gauge({
      name: "ponder_historical_completed_blocks",
      help: "Number of blocks that have been processed for the historical sync",
      labelNames: ["network", "logFilter"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_rpc_request_duration = new prometheus.Histogram({
      name: "ponder_historical_rpc_request_duration",
      help: "Duration of RPC requests completed during the historical sync",
      labelNames: ["network", "method"] as const,
      buckets: httpRequestBucketsInMs,
      registers: [this.registry],
    });

    // Realtime sync metrics
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
    this.ponder_realtime_rpc_request_duration = new prometheus.Histogram({
      name: "ponder_realtime_rpc_request_duration",
      help: "Duration of RPC requests completed during the realtime sync",
      labelNames: ["network", "method"] as const,
      buckets: httpRequestBucketsInMs,
      registers: [this.registry],
    });
  }

  /**
   * Get string representation for all metrics.
   * @returns Metrics encoded using Prometheus v0.0.4 format.
   */
  async getMetrics() {
    return await this.registry.metrics();
  }
}
