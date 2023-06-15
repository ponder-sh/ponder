import prometheus from "prom-client";

/**
 * MetricsService is a wrapper around the `prom-client` NPM package.
 *
 */
export class MetricsService {
  registry: prometheus.Registry;

  constructor() {
    const registry = new prometheus.Registry();

    const counter = new prometheus.Counter({
      name: "test_metric",
      help: "placeholder help message",
      labelNames: ["label1", "label2"],
      registers: [registry],
    });

    setInterval(() => {
      counter.inc();
    }, 500);

    this.registry = registry;
  }

  /**
   * Get string representation for all metrics
   * @returns Metrics encoded using Prometheus v0.0.4 format.
   */
  async metrics() {
    return await this.registry.metrics();
  }
}
