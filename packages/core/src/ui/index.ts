import type { Common } from "@/internal/common.js";
import {
  getAppProgress,
  getIndexingProgress,
  getSyncProgress,
} from "@/internal/metrics.js";
import { buildUiLines, initialUiState } from "./app.js";
import { patchWriteStreams } from "./patch.js";

export function createUi({ common }: { common: Common }) {
  const ui = initialUiState;

  const { refresh, shutdown } = patchWriteStreams({
    getLines: () => buildUiLines(ui),
  });

  // Update the UI state every 100ms (independent of write rate)
  const stateUpdateInterval = setInterval(async () => {
    ui.sync = await getSyncProgress(common.metrics);
    ui.indexing = await getIndexingProgress(common.metrics);
    ui.app = await getAppProgress(common.metrics);

    if (common.options.hostname) ui.hostname = common.options.hostname;
    const port = (await common.metrics.ponder_http_server_port.get()).values[0]!
      .value;
    if (port !== 0) ui.port = port;
  }, 100);

  // Refresh the UI every 32ms
  const refreshInterval = setInterval(() => {
    refresh();
  }, 32);

  common.shutdown.add(() => {
    clearInterval(stateUpdateInterval);
    clearInterval(refreshInterval);
    shutdown();
  });
}
