import { LogFilter } from "@/config/logFilters";
import { Resources } from "@/Ponder";
import { formatEta } from "@/utils/format";

import { buildUiState, setupInkApp, UiState } from "./app";

export class UiService {
  private resources: Resources;
  private logFilters: LogFilter[];

  ui: UiState;
  renderInterval: NodeJS.Timer;
  etaInterval: NodeJS.Timer;
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

      this.render();
    }, 17);

    this.etaInterval = setInterval(() => {
      if (!this.resources.options.uiEnabled) this.logHistoricalSyncProgress();
    }, 1000);
  }

  kill() {
    this.unmount();
    clearInterval(this.renderInterval);
    clearInterval(this.etaInterval);
  }

  private logHistoricalSyncProgress() {
    if (this.ui.isHistoricalSyncComplete) return;

    this.logFilters.forEach((contract) => {
      const stat = this.ui.historicalSyncLogFilterStats[contract.name];
      const { startTimestamp, cachedBlocks, totalBlocks, completedBlocks } =
        stat;

      const currentCompletionRate =
        (cachedBlocks + completedBlocks) / totalBlocks;

      const eta =
        (Date.now() - startTimestamp * 1000) / // Elapsed time in seconds
        (completedBlocks / (totalBlocks - cachedBlocks)); // Progress

      const isDone = currentCompletionRate === 1;
      if (isDone) return;
      const etaText =
        stat.completedBlocks > 5 && eta > 0
          ? `~${formatEta(eta)}`
          : "not started";

      const countText = `${cachedBlocks + completedBlocks}/${totalBlocks}`;

      // this.resources.logger.info(
      //   "historical",
      //   `${contract.name}: ${`(${etaText + " | " + countText})`}`
      // );
    });
  }
}
