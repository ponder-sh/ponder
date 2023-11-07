import { Source } from "@/config/sources";
import type { Common } from "@/Ponder";

import { type UiState, buildUiState, setupInkApp } from "./app";

export class UiService {
  private common: Common;
  private sources: Source[];

  ui: UiState;
  renderInterval: NodeJS.Timer;
  render: () => void;
  unmount: () => void;

  constructor({ common, sources }: { common: Common; sources: Source[] }) {
    this.common = common;
    this.sources = sources;

    this.ui = buildUiState({
      sources: this.sources,
    });

    if (this.common.options.uiEnabled) {
      const { render, unmount } = setupInkApp(this.ui);
      this.render = () => render(this.ui);
      this.unmount = unmount;
    } else {
      this.render = () => undefined;
      this.unmount = () => undefined;
    }

    this.renderInterval = setInterval(async () => {
      const eventSourceNames = Object.keys(
        this.ui.historicalSyncEventSourceStats
      );

      // Historical sync
      const rateMetric = (
        await this.common.metrics.ponder_historical_completion_rate.get()
      ).values;
      const etaMetric = (
        await this.common.metrics.ponder_historical_completion_eta.get()
      ).values;

      eventSourceNames.forEach((name) => {
        const rate = rateMetric.find(
          (m) => m.labels.eventSource === name
        )?.value;
        const eta = etaMetric.find((m) => m.labels.eventSource === name)?.value;

        if (rate !== undefined) {
          this.ui.historicalSyncEventSourceStats[name].rate = rate;
        }
        this.ui.historicalSyncEventSourceStats[name].eta = eta;
      });

      const minRate = Math.min(
        ...eventSourceNames.map(
          (name) => this.ui.historicalSyncEventSourceStats[name].rate
        )
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

      this.ui.networks = connectedNetworks;

      // Indexing
      const matchedEventCount = (
        await this.common.metrics.ponder_indexing_matched_events.get()
      ).values.reduce((a, v) => a + v.value, 0);
      const handledEventCount = (
        await this.common.metrics.ponder_indexing_handled_events.get()
      ).values.reduce((a, v) => a + v.value, 0);
      const processedEventCount = (
        await this.common.metrics.ponder_indexing_processed_events.get()
      ).values.reduce((a, v) => a + v.value, 0);
      const latestProcessedTimestamp =
        (
          await this.common.metrics.ponder_indexing_latest_processed_timestamp.get()
        ).values[0].value ?? 0;
      this.ui.totalMatchedEventCount = matchedEventCount;
      this.ui.handledEventCount = handledEventCount;
      this.ui.processedEventCount = processedEventCount;
      this.ui.eventsProcessedToTimestamp = latestProcessedTimestamp;

      // Errors
      this.ui.indexingError = this.common.errors.hasUserError;

      // Server
      const port = (await this.common.metrics.ponder_server_port.get())
        .values[0].value;
      this.ui.port = port;

      this.render();
    }, 17);
  }

  kill() {
    clearInterval(this.renderInterval);
    this.unmount();
  }
}
