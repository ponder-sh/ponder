import prometheus from "prom-client";

const httpRequestBucketsInMs = [
  10, 25, 50, 75, 100, 200, 300, 400, 500, 750, 1_000, 1_500, 2_000, 4_000,
];

export class MetricsService {
  private registry: prometheus.Registry;

  ponder_historical_task_total: prometheus.Counter<"network" | "kind">;
  ponder_historical_task_failed: prometheus.Counter<"network" | "kind">;
  ponder_historical_task_completed: prometheus.Counter<"network" | "kind">;
  ponder_historical_rpc_request_total: prometheus.Counter<"network" | "method">;
  ponder_historical_rpc_request_duration: prometheus.Histogram<
    "network" | "method"
  >;

  constructor() {
    this.registry = new prometheus.Registry();

    this.ponder_historical_task_total = new prometheus.Counter({
      name: "ponder_historical_task_total",
      help: "Number of historical sync tasks that have been scheduled",
      labelNames: ["network", "kind"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_task_failed = new prometheus.Counter({
      name: "ponder_historical_task_failed",
      help: "Number of historical sync tasks that failed due to an error",
      labelNames: ["network", "kind"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_task_completed = new prometheus.Counter({
      name: "ponder_historical_task_completed",
      help: "Number of historical sync tasks that have been processed",
      labelNames: ["network", "kind"] as const,
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
