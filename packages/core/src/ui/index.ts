import type { Common } from "@/internal/common.js";
import {
  getAppProgress,
  getIndexingProgress,
  getSyncProgress,
} from "@/internal/metrics.js";
import { buildUiState, setupInkApp } from "./app.js";

export function createUi({ common }: { common: Common }) {
  const ui = buildUiState();
  const { render, unmount } = setupInkApp(ui);

  const renderInterval = setInterval(async () => {
    ui.sync = await getSyncProgress(common.metrics);
    ui.indexing = await getIndexingProgress(common.metrics);
    ui.app = await getAppProgress(common.metrics);

    if (common.options.hostname) ui.hostname = common.options.hostname;
    ui.port = (await common.metrics.ponder_http_server_port.get())
      .values[0]!.value;

    render(ui);
  }, 100);

  common.shutdown.add(async () => {
    clearInterval(renderInterval);
    unmount();
  });
}
