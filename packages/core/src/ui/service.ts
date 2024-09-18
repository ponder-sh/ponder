import type { Common } from "@/common/common.js";
import {
  getAppProgress,
  getIndexingProgress,
  getSyncProgress,
} from "@/common/metrics.js";
import { buildUiState, setupInkApp } from "./app.js";

export class UiService {
  private common: Common;

  private ui = buildUiState();
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

  reset() {
    this.ui = buildUiState();
    const metrics = this.common.metrics;

    this.renderInterval = setInterval(async () => {
      // Sync
      this.ui.sync = await getSyncProgress(metrics);

      // Indexing
      this.ui.indexing = await getIndexingProgress(metrics);

      // App
      this.ui.app = await getAppProgress(metrics);

      // Server
      const port = (await metrics.ponder_http_server_port.get()).values[0]!
        .value;
      this.ui.port = port;

      if (this.common.options.hostname) {
        this.ui.hostname = this.common.options.hostname;
      }

      if (this.isKilled) return;
      this.render?.();
    }, 100);
  }

  setReloadableError() {
    this.ui.indexing.hasError = true;
    this.render?.();
  }

  kill() {
    this.isKilled = true;
    clearInterval(this.renderInterval);
    this.unmount?.();
  }
}
