import type { Common } from "@/common/common.js";
import {
  getHistoricalSyncProgress,
  getIndexingProgress,
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
      // Historical sync
      this.ui.historical = await getHistoricalSyncProgress(metrics);

      // Realtime sync
      // const connectedNetworks = (
      //   await metrics.ponder_realtime_is_connected.get()
      // ).values
      //   .filter((m) => m.value === 1)
      //   .map((m) => m.labels.network)
      //   .filter((n): n is string => typeof n === "string");
      // const allNetworks = [
      //   ...new Set(
      //     sources
      //       .filter((s) => s.endBlock === undefined)
      //       .map((s) => s.networkName),
      //   ),
      // ];
      // this.ui.realtimeSyncNetworks = allNetworks.map((networkName) => ({
      //   name: networkName,
      //   isConnected: connectedNetworks.includes(networkName),
      // }));

      // Indexing
      this.ui.indexing = await getIndexingProgress(metrics);

      // Server
      const port = (await metrics.ponder_http_server_port.get()).values[0]!
        .value;
      this.ui.port = port;

      if (this.isKilled) return;
      this.render?.();
    }, 17);
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
