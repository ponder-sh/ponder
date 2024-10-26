import type { Common } from "@/common/common.js";
import {
  getAppProgress,
  getIndexingProgress,
  getSyncProgress,
} from "@/common/metrics.js";
import { buildUiState, setupInkApp } from "./app.js";

export function createUi({ common }: { common: Common }) {
  const ui = buildUiState();
  const { render, unmount } = setupInkApp(ui);

  let isKilled = false;

  const renderInterval = setInterval(async () => {
    if (isKilled) return;

    ui.sync = await getSyncProgress(common.metrics);
    ui.indexing = await getIndexingProgress(common.metrics);
    ui.app = await getAppProgress(common.metrics);

    if (common.options.hostname) ui.hostname = common.options.hostname;
    ui.port = (await common.metrics.ponder_http_server_port.get())
      .values[0]!.value;

    render(ui);
  }, 100);

  const kill = () => {
    isKilled = true;
    clearInterval(renderInterval);
    unmount();
  };

  return {
    kill,
  };
}
