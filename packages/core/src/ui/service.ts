import type { Common } from "@/common/common.js";
import { getHistoricalSyncStats } from "@/common/metrics.js";
import type { Source } from "@/config/sources.js";
import { buildUiState, setupInkApp } from "./app.js";

export class UiService {
  private common: Common;

  private ui = buildUiState({ sources: [] });
  private renderInterval?: NodeJS.Timeout;
  private render?: () => void;
  private unmount?: () => void;
  private isKilled = false;

  constructor({ common }: { common: Common }) {
    this.common = common;

    const { render, unmount } = setupInkApp(this.ui);
    this.render = () => render(this.ui);
    this.unmount = unmount;
  }

  reset(sources: Source[]) {
    this.ui = buildUiState({ sources });

    this.renderInterval = setInterval(async () => {
      // Historical sync
      this.ui.historicalSyncStats = await getHistoricalSyncStats({
        metrics: this.common.metrics,
        sources,
      });

      const minRate = Math.min(
        ...this.ui.historicalSyncStats.map((s) => s.rate),
      );

      if (!this.ui.isHistoricalSyncComplete && minRate === 1) {
        this.ui.isHistoricalSyncComplete = true;
      }

      // Realtime sync
      const connectedNetworks = (
        await this.common.metrics.ponder_realtime_is_connected.get()
      ).values
        .filter((m) => m.value === 1)
        .map((m) => m.labels.network)
        .filter((n): n is string => typeof n === "string");
      const allNetworks = [
        ...new Set(
          sources
            .filter((s) => s.endBlock === undefined)
            .map((s) => s.networkName),
        ),
      ];

      this.ui.realtimeSyncNetworks = allNetworks.map((networkName) => ({
        name: networkName,
        isConnected: connectedNetworks.includes(networkName),
      }));

      // Indexing
      const totalSecondsMetric = (
        await this.common.metrics.ponder_indexing_total_seconds.get()
      ).values;
      const completedSecondsMetric = (
        await this.common.metrics.ponder_indexing_completed_seconds.get()
      ).values;

      const completedEventsMetric = (
        await this.common.metrics.ponder_indexing_completed_events.get()
      ).values;

      this.ui.indexingTable = completedEventsMetric.map((m) => ({
        eventName: m.labels.event as string,
        networkName: m.labels.network as string,
        count: m.value,
        averageDuration: 0,
        errorCount: 0,
      }));

      const indexingFunctionErrorMetric = (
        await this.common.metrics.ponder_indexing_function_error_total.get()
      ).values;
      for (const m of indexingFunctionErrorMetric) {
        const row = this.ui.indexingTable.find(
          (r) =>
            r.eventName === m.labels.event &&
            r.networkName === m.labels.network,
        );
        if (row) row.errorCount = m.value;
      }

      const indexingFunctionDurationMetric = (
        await this.common.metrics.ponder_indexing_function_duration.get()
      ).values;

      const durationSumByEvent: Record<string, Record<string, number>> = {};
      const durationCountByEvent: Record<string, Record<string, number>> = {};
      for (const m of indexingFunctionDurationMetric) {
        if (m.metricName === "ponder_indexing_function_duration_sum")
          (durationSumByEvent[m.labels.event!] ??= {})[m.labels.network!] =
            m.value;
        if (m.metricName === "ponder_indexing_function_duration_count")
          (durationCountByEvent[m.labels.event!] ??= {})[m.labels.network!] =
            m.value;
      }

      for (const row of this.ui.indexingTable) {
        const sum = durationSumByEvent[row.eventName]?.[row.networkName] ?? 0;
        const count =
          durationCountByEvent[row.eventName]?.[row.networkName] ?? 0;
        row.averageDuration = count === 0 ? 0 : sum / count;
      }

      this.ui.indexingStats = {
        completedSeconds: completedSecondsMetric[0]?.value ?? 0,
        totalSeconds: totalSecondsMetric[0]?.value ?? 0,
      };

      const indexingCompletedToTimestamp =
        (await this.common.metrics.ponder_indexing_completed_timestamp.get())
          .values[0].value ?? 0;
      this.ui.indexingCompletedToTimestamp = indexingCompletedToTimestamp;

      // Server
      const port = (await this.common.metrics.ponder_server_port.get())
        .values[0].value;
      this.ui.port = port;

      if (this.isKilled) return;
      this.render?.();
    }, 17);
  }

  setReloadableError() {
    this.ui.indexingError = true;
    this.render?.();
  }

  kill() {
    this.isKilled = true;
    clearInterval(this.renderInterval);
    this.unmount?.();
  }
}
