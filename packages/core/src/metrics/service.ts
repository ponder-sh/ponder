import prometheus from "prom-client";

const httpRequestBucketsInMs = [
  5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 250, 300, 350, 400, 450,
  500, 750, 1_000, 2_000, 10_000,
];

const httpRequestSizeInBytes = [
  10, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 50_000, 100_000, 250_000,
  500_000, 1_000_000, 5_000_000, 10_000_000,
];

export class MetricsService {
  private registry: prometheus.Registry;

  ponder_historical_rpc_request_duration: prometheus.Histogram<
    "network" | "method"
  >;
  ponder_historical_total_blocks: prometheus.Gauge<"network" | "eventSource">;
  ponder_historical_cached_blocks: prometheus.Gauge<"network" | "eventSource">;
  ponder_historical_completed_blocks: prometheus.Gauge<
    "network" | "eventSource"
  >;
  ponder_historical_completion_rate: prometheus.Gauge<
    "network" | "eventSource"
  >;
  ponder_historical_completion_eta: prometheus.Gauge<"network" | "eventSource">;

  ponder_realtime_is_connected: prometheus.Gauge<"network">;
  ponder_realtime_latest_block_number: prometheus.Gauge<"network">;
  ponder_realtime_latest_block_timestamp: prometheus.Gauge<"network">;
  ponder_realtime_rpc_request_duration: prometheus.Histogram<
    "network" | "method"
  >;

  ponder_handlers_matched_events: prometheus.Gauge<"eventName">;
  ponder_handlers_handled_events: prometheus.Gauge<"eventName">;
  ponder_handlers_processed_events: prometheus.Gauge<"eventName">;
  ponder_handlers_has_error: prometheus.Gauge;
  ponder_handlers_latest_processed_timestamp: prometheus.Gauge;

  ponder_server_port: prometheus.Gauge;
  ponder_server_request_size: prometheus.Histogram<
    "method" | "path" | "status"
  >;
  ponder_server_response_size: prometheus.Histogram<
    "method" | "path" | "status"
  >;
  ponder_server_response_duration: prometheus.Histogram<
    "method" | "path" | "status"
  >;

  constructor() {
    this.registry = new prometheus.Registry();

    prometheus.collectDefaultMetrics({
      register: this.registry,
      prefix: "ponder_default_",
    });

    this.ponder_historical_rpc_request_duration = new prometheus.Histogram({
      name: "ponder_historical_rpc_request_duration",
      help: "Duration of RPC requests completed during the historical sync",
      labelNames: ["network", "method"] as const,
      buckets: httpRequestBucketsInMs,
      registers: [this.registry],
    });
    this.ponder_historical_total_blocks = new prometheus.Gauge({
      name: "ponder_historical_total_blocks",
      help: "Number of blocks required for the historical sync",
      labelNames: ["network", "eventSource"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_cached_blocks = new prometheus.Gauge({
      name: "ponder_historical_cached_blocks",
      help: "Number of blocks that were found in the cache for the historical sync",
      labelNames: ["network", "eventSource"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_completed_blocks = new prometheus.Gauge({
      name: "ponder_historical_completed_blocks",
      help: "Number of blocks that have been processed for the historical sync",
      labelNames: ["network", "eventSource"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_completion_rate = new prometheus.Gauge({
      name: "ponder_historical_completion_rate",
      help: "Completion rate (0 to 1) of the historical sync",
      labelNames: ["network", "eventSource"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_completion_eta = new prometheus.Gauge({
      name: "ponder_historical_completion_eta",
      help: "Estimated number of milliseconds remaining to complete the historical sync",
      labelNames: ["network", "eventSource"] as const,
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
    this.ponder_realtime_rpc_request_duration = new prometheus.Histogram({
      name: "ponder_realtime_rpc_request_duration",
      help: "Duration of RPC requests completed during the realtime sync",
      labelNames: ["network", "method"] as const,
      buckets: httpRequestBucketsInMs,
      registers: [this.registry],
    });

    this.ponder_handlers_matched_events = new prometheus.Gauge({
      name: "ponder_handlers_matched_events",
      help: "Number of available events for all log filters",
      labelNames: ["eventName"] as const,
      registers: [this.registry],
    });
    this.ponder_handlers_handled_events = new prometheus.Gauge({
      name: "ponder_handlers_handled_events",
      help: "Number of available events for which there is a handler function registered",
      labelNames: ["eventName"] as const,
      registers: [this.registry],
    });
    this.ponder_handlers_processed_events = new prometheus.Gauge({
      name: "ponder_handlers_processed_events",
      help: "Number of available events that have been processed",
      labelNames: ["eventName"] as const,
      registers: [this.registry],
    });
    this.ponder_handlers_has_error = new prometheus.Gauge({
      name: "ponder_handlers_has_error",
      help: "Boolean (0 or 1) indicating if an error was encountered while running handlers",
      registers: [this.registry],
    });
    this.ponder_handlers_latest_processed_timestamp = new prometheus.Gauge({
      name: "ponder_handlers_latest_processed_timestamp",
      help: "Block timestamp of the latest processed event",
      registers: [this.registry],
    });

    this.ponder_server_port = new prometheus.Gauge({
      name: "ponder_server_port",
      help: "Port that the server is listening on",
      registers: [this.registry],
    });
    this.ponder_server_request_size = new prometheus.Histogram({
      name: "ponder_server_request_size",
      help: "Size of HTTP requests received by the server",
      labelNames: ["method", "path", "status"] as const,
      buckets: httpRequestSizeInBytes,
      registers: [this.registry],
    });
    this.ponder_server_response_size = new prometheus.Histogram({
      name: "ponder_server_response_size",
      help: "Size of HTTP responses served the server",
      labelNames: ["method", "path", "status"] as const,
      buckets: httpRequestSizeInBytes,
      registers: [this.registry],
    });
    this.ponder_server_response_duration = new prometheus.Histogram({
      name: "ponder_server_response_duration",
      help: "Duration of HTTP responses served the server",
      labelNames: ["method", "path", "status"] as const,
      buckets: httpRequestSizeInBytes,
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
