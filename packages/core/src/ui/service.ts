import type { Source } from "@/config/sources.js";
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

    console.log(sources);

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
      // const contractNames = Object.keys(this.ui.historicalSyncStats);
      // console.log({ eventSourceNames });

      // Historical sync
      const rateMetric = (
        await this.common.metrics.ponder_historical_completion_rate.get()
      ).values;
      const etaMetric = (
        await this.common.metrics.ponder_historical_completion_eta.get()
      ).values;

      this.ui.historicalSyncStats = this.sources.map(
        ({ networkName, contractName }) => {
          const rate = rateMetric.find(
            ({ labels }) =>
              labels.contract === contractName &&
              labels.network === networkName,
          )?.value;
          const eta = etaMetric.find(
            ({ labels }) =>
              labels.contract === contractName &&
              labels.network === networkName,
          )?.value;
          return {
            contract: contractName,
            network: networkName,
            rate: rate ?? 0,
            eta,
          };
        },
      );

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
