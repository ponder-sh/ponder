import { MessageKind } from "@/common/LoggerService";
import { formatEta } from "@/common/utils";
import { Resources } from "@/Ponder";

import { getUiState, hydrateUi, render, UiState, unmount } from "./app";

export class UiService {
  resources: Resources;

  ui: UiState;
  renderInterval: NodeJS.Timer;
  etaInterval: NodeJS.Timer;
  render: () => void;

  constructor({ resources }: { resources: Resources }) {
    this.resources = resources;

    this.ui = getUiState(this.resources.options);
    hydrateUi({ ui: this.ui, contracts: this.resources.contracts });
    this.render = () => render(this.ui);

    this.renderInterval = setInterval(() => {
      if (this.resources.options.LOG_TYPE === "dev") this.render();
    }, 17);

    this.etaInterval = setInterval(() => {
      this.updateBackfillEta();
      this.logBackfillProgress();
    }, 1000);
  }

  kill() {
    unmount();
    clearInterval(this.renderInterval);
    clearInterval(this.etaInterval);
  }

  private updateBackfillEta = () => {
    this.resources.contracts
      .filter((contract) => contract.isIndexed)
      .forEach((contract) => {
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
    if (
      this.resources.options.LOG_TYPE === "start" &&
      !this.ui.isBackfillComplete
    ) {
      this.resources.contracts
        .filter((contract) => contract.isIndexed)
        .forEach((contract) => {
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
}
