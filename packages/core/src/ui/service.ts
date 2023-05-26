import { MessageKind } from "@/common/LoggerService";
import { formatEta } from "@/common/utils";
import { LogFilter } from "@/config/logFilters";
import { Resources } from "@/Ponder";

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

    this.renderInterval = setInterval(() => {
      Object.keys(this.ui.stats).forEach((name) => {
        this.ui.stats[name] = {
          ...this.ui.stats[name],
          logCurrent: this.ui.stats[name].logCurrent + 1,
          logAvgDuration:
            (Date.now() - this.ui.stats[name].logStartTimestamp) /
            this.ui.stats[name].logCurrent,
          logAvgBlockCount:
            this.ui.stats[name].blockTotal / this.ui.stats[name].logCurrent,
        };

        this.ui.stats[name] = {
          ...this.ui.stats[name],
          blockCurrent: this.ui.stats[name].blockCurrent + 1,
          blockAvgDuration:
            (Date.now() - this.ui.stats[name].blockStartTimestamp) /
            this.ui.stats[name].blockCurrent,
        };
      });

      this.render();
    }, 17);

    this.etaInterval = setInterval(() => {
      this.updateBackfillEta();
      if (!this.resources.options.uiEnabled) this.logBackfillProgress();
    }, 1000);
  }

  kill() {
    this.unmount();
    clearInterval(this.renderInterval);
    clearInterval(this.etaInterval);
  }

  private updateBackfillEta = () => {
    this.logFilters.forEach((contract) => {
      const stats = this.ui.stats[contract.name];

      const logTime =
        (stats.logTotal - stats.logCurrent) * stats.logAvgDuration;

      const blockTime =
        (stats.blockTotal - stats.blockCurrent) * stats.blockAvgDuration;

      const estimatedAdditionalBlocks =
        (stats.logTotal - stats.logCurrent) * stats.logAvgBlockCount;

      const estimatedAdditionalBlockTime =
        estimatedAdditionalBlocks * stats.blockAvgDuration;

      const eta = Math.max(logTime, blockTime + estimatedAdditionalBlockTime);

      this.ui.stats[contract.name].eta = Number.isNaN(eta) ? 0 : eta;
    });
  };

  private logBackfillProgress() {
    if (this.ui.isBackfillComplete) return;

    this.logFilters.forEach((contract) => {
      const stat = this.ui.stats[contract.name];

      const current = stat.logCurrent + stat.blockCurrent;
      const total = stat.logTotal + stat.blockTotal;
      const isDone = current === total;
      if (isDone) return;
      const etaText =
        stat.logCurrent > 5 && stat.eta > 0
          ? `~${formatEta(stat.eta)}`
          : "not started";

      const countText = `${current}/${total}`;

      this.resources.logger.logMessage(
        MessageKind.BACKFILL,
        `${contract.name}: ${`(${etaText + " | " + countText})`}`
      );
    });
  }
}
