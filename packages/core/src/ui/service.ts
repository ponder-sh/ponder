import { LogFilter } from "@/config/logFilters";
import { Resources } from "@/Ponder";

import { buildUiState, setupInkApp, UiState } from "./app";

export class UiService {
  private resources: Resources;
  private logFilters: LogFilter[];

  ui: UiState;
  renderInterval: NodeJS.Timer;
  render: () => void;
  unmount: () => void;

  constructor({
    resources,
    logFilters,
  }: {
    resources: Resources;
    logFilters: LogFilter[];
  }) {
    this.resources = resources;
    this.logFilters = logFilters;

    this.ui = buildUiState({ logFilters: this.logFilters });

    if (this.resources.options.uiEnabled) {
      const { render, unmount } = setupInkApp(this.ui);
      this.render = () => render(this.ui);
      this.unmount = unmount;
    } else {
      this.render = () => undefined;
      this.unmount = () => undefined;
    }

    this.renderInterval = setInterval(async () => {
      const logFilterNames = Object.keys(this.ui.historicalSyncLogFilterStats);

      // Historical sync
      const rateMetric = (
        await this.resources.metrics.ponder_historical_completion_rate.get()
      ).values;
      const etaMetric = (
        await this.resources.metrics.ponder_historical_completion_eta.get()
      ).values;

      logFilterNames.forEach((name) => {
        const rate = rateMetric.find((m) => m.labels.logFilter === name)?.value;
        const eta = etaMetric.find((m) => m.labels.logFilter === name)?.value;

        if (rate !== undefined) {
          this.ui.historicalSyncLogFilterStats[name].rate = rate;
        }
        this.ui.historicalSyncLogFilterStats[name].eta = eta;
      });

      const minRate = Math.min(
        ...logFilterNames.map(
          (name) => this.ui.historicalSyncLogFilterStats[name].rate
        )
      );

      if (!this.ui.isHistoricalSyncComplete && minRate === 1) {
        this.ui.isHistoricalSyncComplete = true;
      }

      // Realtime sync
      const connectedNetworks = (
        await this.resources.metrics.ponder_realtime_is_connected.get()
      ).values
        .filter((m) => m.value === 1)
        .map((m) => m.labels.network)
        .filter((n): n is string => typeof n === "string");

      this.ui.networks = connectedNetworks;

      // Handlers
      const matchedEvents = (
        await this.resources.metrics.ponder_handlers_matched_events.get()
      ).values.reduce((a, v) => a + v.value, 0);
      const handledEvents = (
        await this.resources.metrics.ponder_handlers_handled_events.get()
      ).values.reduce((a, v) => a + v.value, 0);
      const processedEvents = (
        await this.resources.metrics.ponder_handlers_processed_events.get()
      ).values.reduce((a, v) => a + v.value, 0);
      const latestProcessedTimestamp =
        (
          await this.resources.metrics.ponder_handlers_latest_processed_timestamp.get()
        ).values[0].value ?? 0;
      this.ui.handlersTotal = matchedEvents;
      this.ui.handlersHandledTotal = handledEvents;
      this.ui.handlersCurrent = processedEvents;
      this.ui.handlersToTimestamp = latestProcessedTimestamp;

      // Errors
      this.ui.handlerError = this.resources.errors.hasUserError;

      // Server
      const port = (await this.resources.metrics.ponder_server_port.get())
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
