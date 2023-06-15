import prometheus from "prom-client";

export class MetricsService {
  private registry: prometheus.Registry;

  ponder_historical_log_task_total: prometheus.Counter<"network">;
  ponder_historical_log_task_processed: prometheus.Counter<"network">;
  ponder_historical_block_task_total: prometheus.Counter<"network">;
  ponder_historical_block_task_processed: prometheus.Counter<"network">;
  ponder_historical_rpc_request_total: prometheus.Counter<"network" | "method">;
  ponder_historical_rpc_request_duration: prometheus.Histogram<
    "network" | "method"
  >;

  constructor() {
    this.registry = new prometheus.Registry();

    this.ponder_historical_log_task_total = new prometheus.Counter({
      name: "ponder_historical_log_task_total",
      help: "Number of historical sync log tasks that have been scheduled",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_log_task_processed = new prometheus.Counter({
      name: "ponder_historical_log_task_processed",
      help: "Number of historical sync log tasks that have been processed",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_block_task_total = new prometheus.Counter({
      name: "ponder_historical_block_task_total",
      help: "Number of historical sync block tasks that have been scheduled",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_block_task_processed = new prometheus.Counter({
      name: "ponder_historical_block_task_processed",
      help: "Number of historical sync block tasks that have been processed",
      labelNames: ["network"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_rpc_request_total = new prometheus.Counter({
      name: "ponder_historical_rpc_request_total",
      help: "Number of RPC requests executed during the historical sync",
      labelNames: ["network", "method"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_rpc_request_duration = new prometheus.Histogram({
      name: "ponder_historical_rpc_request_duration",
      help: "Duration of RPC requests completed during the historical sync",
      labelNames: ["network", "method"] as const,
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
