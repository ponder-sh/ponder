import type { Common } from "@/Ponder.js";
import type { Source } from "@/config/sources.js";
import { getHistoricalSyncStats } from "@/metrics/utils.js";

import { type UiState, buildUiState, setupInkApp } from "./app.js";

export class UiService {
  private common: Common;
  private sources: Source[];

  ui: UiState;
  renderInterval: NodeJS.Timeout;
  render: () => void;
  unmount: () => void;

  constructor({ common, sources }: { common: Common; sources: Source[] }) {
    this.common = common;
    this.sources = sources;

    this.ui = buildUiState({ sources: this.sources });

    if (this.common.options.uiEnabled) {
      const { render, unmount } = setupInkApp(this.ui);
      this.render = () => render(this.ui);
      this.unmount = unmount;
    } else {
      this.render = () => undefined;
      this.unmount = () => undefined;
    }

    this.renderInterval = setInterval(async () => {
      // Historical sync

      this.ui.historicalSyncStats = await getHistoricalSyncStats({
        metrics: this.common.metrics,
        sources: this.sources,
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
          this.sources
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

      const eventNames = totalSecondsMetric.map(
        (m) => m.labels.event as string,
      );

      this.ui.indexingStats = eventNames.map((event) => {
        const totalSeconds = totalSecondsMetric.find(
          (m) => m.labels.event === event,
        )?.value;
        const completedSeconds = completedSecondsMetric.find(
          (m) => m.labels.event === event,
        )?.value;
        const completedEventCount = completedEventsMetric
          .filter((m) => m.labels.event === event)
          .reduce((a, v) => a + v.value, 0);

        return { event, totalSeconds, completedSeconds, completedEventCount };
      });

      const indexingCompletedToTimestamp =
        (await this.common.metrics.ponder_indexing_completed_timestamp.get())
          .values[0].value ?? 0;
      this.ui.indexingCompletedToTimestamp = indexingCompletedToTimestamp;

      // Server
      const port = (await this.common.metrics.ponder_server_port.get())
        .values[0].value;
      this.ui.port = port;

      this.render();
    }, 17);
  }

  resetHistoricalState() {
    this.ui.isHistoricalSyncComplete = false;
  }

  kill() {
    clearInterval(this.renderInterval);
    this.unmount();
  }
}
