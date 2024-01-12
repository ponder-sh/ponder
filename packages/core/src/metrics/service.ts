import type { DatabaseConfig } from "@/config/database.js";
import type { Pool } from "pg";
import prometheus from "prom-client";

const httpRequestBucketsInMs = [
  0.1, 0.25, 0.5, 0.75, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1_000, 2_000,
  4_000, 8_000, 16_000, 32_000,
];

const httpRequestSizeInBytes = [
  10, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 50_000, 100_000, 250_000,
  500_000, 1_000_000, 5_000_000, 10_000_000,
];

export class MetricsService {
  private registry: prometheus.Registry;

  ponder_rpc_request_duration: prometheus.Histogram<"network" | "method">;
  ponder_rpc_request_lag: prometheus.Histogram<"network" | "method">;

  ponder_historical_start_timestamp: prometheus.Gauge<"network">;
  ponder_historical_total_blocks: prometheus.Gauge<"network" | "contract">;
  ponder_historical_cached_blocks: prometheus.Gauge<"network" | "contract">;
  ponder_historical_completed_blocks: prometheus.Gauge<"network" | "contract">;

  ponder_realtime_is_connected: prometheus.Gauge<"network">;
  ponder_realtime_latest_block_number: prometheus.Gauge<"network">;
  ponder_realtime_latest_block_timestamp: prometheus.Gauge<"network">;

  ponder_indexing_matched_events: prometheus.Gauge<
    "network" | "contract" | "event"
  >;
  ponder_indexing_handled_events: prometheus.Gauge<
    "network" | "contract" | "event"
  >;
  ponder_indexing_processed_events: prometheus.Gauge<
    "network" | "contract" | "event"
  >;
  ponder_indexing_has_error: prometheus.Gauge;
  ponder_indexing_latest_processed_timestamp: prometheus.Gauge;

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

  ponder_sync_store_method_duration: prometheus.Histogram<"method">;
  ponder_indexing_store_method_duration: prometheus.Histogram<
    "table" | "method"
  >;

  ponder_postgres_idle_connection_count: prometheus.Counter = null!;
  ponder_postgres_total_connection_count: prometheus.Counter = null!;
  ponder_postgres_request_queue_count: prometheus.Counter = null!;
  ponder_postgres_query_count: prometheus.Counter = null!;

  ponder_sqlite_query_count: prometheus.Counter = null!;

  constructor() {
    this.registry = new prometheus.Registry();

    prometheus.collectDefaultMetrics({
      register: this.registry,
      prefix: "ponder_default_",
    });

    this.ponder_rpc_request_duration = new prometheus.Histogram({
      name: "ponder_rpc_request_duration",
      help: "Duration of RPC requests",
      labelNames: ["network", "method"] as const,
      buckets: httpRequestBucketsInMs,
      registers: [this.registry],
    });
    this.ponder_rpc_request_lag = new prometheus.Histogram({
      name: "ponder_rpc_request_lag",
      help: "Time RPC requests spend waiting in the request queue",
      labelNames: ["network", "method"] as const,
      buckets: httpRequestBucketsInMs,
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
      labelNames: ["network", "contract"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_cached_blocks = new prometheus.Gauge({
      name: "ponder_historical_cached_blocks",
      help: "Number of blocks that were found in the cache for the historical sync",
      labelNames: ["network", "contract"] as const,
      registers: [this.registry],
    });
    this.ponder_historical_completed_blocks = new prometheus.Gauge({
      name: "ponder_historical_completed_blocks",
      help: "Number of blocks that have been processed for the historical sync",
      labelNames: ["network", "contract"] as const,
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

    this.ponder_indexing_matched_events = new prometheus.Gauge({
      name: "ponder_indexing_matched_events",
      help: "Number of available events for all log filters",
      labelNames: ["network", "contract", "event"] as const,
      registers: [this.registry],
    });
    this.ponder_indexing_handled_events = new prometheus.Gauge({
      name: "ponder_indexing_handled_events",
      help: "Number of available events for which there is an indexing function registered",
      labelNames: ["network", "contract", "event"] as const,
      registers: [this.registry],
    });
    this.ponder_indexing_processed_events = new prometheus.Gauge({
      name: "ponder_indexing_processed_events",
      help: "Number of available events that have been processed",
      labelNames: ["network", "contract", "event"] as const,
      registers: [this.registry],
    });
    this.ponder_indexing_has_error = new prometheus.Gauge({
      name: "ponder_indexing_has_error",
      help: "Boolean (0 or 1) indicating if an error was encountered while running user code",
      registers: [this.registry],
    });
    this.ponder_indexing_latest_processed_timestamp = new prometheus.Gauge({
      name: "ponder_indexing_latest_processed_timestamp",
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

    this.ponder_sync_store_method_duration = new prometheus.Histogram({
      name: "ponder_sync_store_method_duration",
      help: "Duration of database operations in the sync store",
      labelNames: ["method"] as const,
      buckets: httpRequestBucketsInMs,
      registers: [this.registry],
    });
    this.ponder_indexing_store_method_duration = new prometheus.Histogram({
      name: "ponder_indexing_store_method_duration",
      help: "Duration of database operations in the sync store",
      labelNames: ["table", "method"] as const,
      buckets: httpRequestBucketsInMs,
      registers: [this.registry],
    });
  }

  registerDatabaseMetrics(database: DatabaseConfig) {
    if (database.sync.kind === "postgres") {
      this.ponder_postgres_query_count = new prometheus.Counter({
        name: "ponder_postgres_query_count",
        help: "Number of queries executed by Postgres",
        labelNames: ["kind"] as const,
        registers: [this.registry],
      });

      const pool = database.sync.pool as unknown as Pool;
      this.ponder_postgres_idle_connection_count = new prometheus.Gauge({
        name: "ponder_postgres_idle_connection_count",
        help: "Number of idle connections in the pool",
        registers: [this.registry],
        collect() {
          this.set(pool.idleCount);
        },
      });
      this.ponder_postgres_total_connection_count = new prometheus.Gauge({
        name: "ponder_postgres_total_connection_count",
        help: "Total number of connections in the pool",
        registers: [this.registry],
        collect() {
          this.set(pool.totalCount);
        },
      });
      this.ponder_postgres_request_queue_count = new prometheus.Gauge({
        name: "ponder_postgres_request_queue_count",
        help: "Number of transaction or query requests waiting for an available connection",
        registers: [this.registry],
        collect() {
          this.set(pool.waitingCount);
        },
      });
    } else {
      this.ponder_sqlite_query_count = new prometheus.Counter({
        name: "ponder_sqlite_query_count",
        help: "Number of queries executed by SQLite",
        labelNames: ["kind"] as const,
        registers: [this.registry],
      });
    }
  }

  /**
   * Get string representation for all metrics.
   * @returns Metrics encoded using Prometheus v0.0.4 format.
   */
  async getMetrics() {
    return await this.registry.metrics();
  }

  async resetMetrics() {
    this.registry.resetMetrics();
  }
}
