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
      // Historical sync
      const totalBlocksMetric =
        await this.resources.metrics.ponder_historical_total_blocks.get();
      const cachedBlocksMetric =
        await this.resources.metrics.ponder_historical_cached_blocks.get();
      const completedBlocksMetric =
        await this.resources.metrics.ponder_historical_completed_blocks.get();

      Object.keys(this.ui.historicalSyncLogFilterStats).forEach((name) => {
        const totalBlocks =
          totalBlocksMetric.values.find((v) => v.labels.logFilter === name)
            ?.value ?? 0;
        const cachedBlocks =
          cachedBlocksMetric.values.find((v) => v.labels.logFilter === name)
            ?.value ?? 0;
        const completedBlocks =
          completedBlocksMetric.values.find((v) => v.labels.logFilter === name)
            ?.value ?? 0;

        this.ui.historicalSyncLogFilterStats[name].totalBlocks = totalBlocks;
        this.ui.historicalSyncLogFilterStats[name].cachedBlocks = cachedBlocks;
        this.ui.historicalSyncLogFilterStats[name].completedBlocks =
          completedBlocks;
      });

      // Handlers
      const matchedEventsMetric =
        await this.resources.metrics.ponder_handlers_matched_events.get();
      const handledEventsMetric =
        await this.resources.metrics.ponder_handlers_handled_events.get();
      const processedEventsMetric =
        await this.resources.metrics.ponder_handlers_processed_events.get();
      const latestProcessedTimestampMetric =
        await this.resources.metrics.ponder_handlers_latest_processed_timestamp.get();

      this.ui.handlersTotal = matchedEventsMetric.values.reduce(
        (a, v) => a + v.value,
        0
      );
      this.ui.handlersHandledTotal = handledEventsMetric.values.reduce(
        (a, v) => a + v.value,
        0
      );
      this.ui.handlersCurrent = processedEventsMetric.values.reduce(
        (a, v) => a + v.value,
        0
      );
      this.ui.handlersToTimestamp =
        latestProcessedTimestampMetric.values[0].value ?? 0;

      // Errors
      this.ui.handlerError = this.resources.errors.hasUserError;

      this.render();
    }, 17);
  }

  kill() {
    clearInterval(this.renderInterval);
    this.unmount();
  }
}
