import type { Source } from "@/config/sources.js";
import { getHistoricalSyncStats } from "@/metrics/utils.js";
import type { Common } from "@/Ponder.js";

import { buildUiState, setupInkApp, type UiState } from "./app.js";

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

  resetHistoricalState() {
    this.ui.isHistoricalSyncComplete = false;
  }

  kill() {
    clearInterval(this.renderInterval);
    this.unmount();
  }
}
